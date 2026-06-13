/**
 * Crypto core (F1201–F1210) — the misuse-resistant foundation for the encrypted
 * vault (Epic 13). All higher tiers (storage, sync, per-note secrets) build on
 * exactly these primitives; nothing else in the codebase should call libsodium
 * directly.
 *
 * Audited primitive choices (F1201):
 *   - Passphrase → key:        Argon2id  (crypto_pwhash, ALG_ARGON2ID13)
 *   - Authenticated encryption: XChaCha20-Poly1305 IETF  (192-bit random nonce,
 *                               so nonces never collide and never need a counter)
 *   - Key wrapping:            the same AEAD, data key sealed under the master key
 *   - Constant-time compare:   sodium.memcmp
 *
 * Misuse-resistance (F1206):
 *   - Callers never supply a nonce — `seal()` generates a fresh random one every
 *     time and packs it into the envelope. There is no "encrypt with this nonce"
 *     entry point to get wrong.
 *   - Keys are branded types, so a master key can't be passed where a data key is
 *     expected without an explicit, visible cast.
 *   - Every ciphertext is a self-describing, versioned envelope (F1209): the
 *     params version and algorithm id travel with the bytes, so we can rotate
 *     algorithms or KDF costs later without guessing how old data was written.
 *
 * libsodium is loaded lazily via dynamic import so it stays off the initial web
 * bundle until the vault is actually used.
 */

// Type-only namespace import — emits no runtime require, so importing
// @fables/core never pulls libsodium into a bundle on its own. The actual
// library is loaded lazily inside `cryptoReady()`.
import type * as SodiumNS from 'libsodium-wrappers-sumo';

type Sodium = typeof SodiumNS;

let _sodium: Sodium | null = null;

/** Resolve (and memoize) the initialized libsodium instance. */
export async function cryptoReady(): Promise<Sodium> {
  if (_sodium) return _sodium;
  const mod = (await import('libsodium-wrappers-sumo')) as unknown as {
    default?: Sodium;
  } & Sodium;
  const sodium = (mod.default ?? mod) as Sodium;
  await sodium.ready;
  _sodium = sodium;
  return sodium;
}

// ── Branded key types (F1206) ───────────────────────────────────────────────

/** A 256-bit symmetric key. Branded so the key hierarchy can't be crossed by accident. */
export type SecretKey = Uint8Array & { readonly __brand: 'SecretKey' };
/** The top-level key derived from the passphrase; only ever wraps/unwraps data keys. */
export type MasterKey = SecretKey & { readonly __role: 'master' };
/** A per-vault/per-note data key; the thing that actually encrypts content. */
export type DataKey = SecretKey & { readonly __role: 'data' };

// ── Parameter versioning (F1209) ────────────────────────────────────────────

export type KdfStrength = 'interactive' | 'moderate' | 'sensitive';

export interface CryptoParams {
  /** Bumped whenever the KDF cost or algorithm set changes. */
  readonly version: number;
  readonly kdf: 'argon2id13';
  readonly kdfStrength: KdfStrength;
  readonly aead: 'xchacha20poly1305-ietf';
}

/** Current parameters new vaults are created with. */
export const CURRENT_CRYPTO_PARAMS: CryptoParams = {
  version: 1,
  kdf: 'argon2id13',
  kdfStrength: 'moderate',
  aead: 'xchacha20poly1305-ietf',
};

const ALG_XCHACHA20POLY1305 = 1 as const;

// ── Initialization / utility ────────────────────────────────────────────────

const SALT_BYTES = 16; // crypto_pwhash_SALTBYTES
const KEY_BYTES = 32; // crypto_secretbox/aead key length

/** Fresh random salt for a new vault's key derivation. */
export async function generateSalt(): Promise<Uint8Array> {
  const s = await cryptoReady();
  return s.randombytes_buf(SALT_BYTES);
}

/** Fresh random 256-bit data key (F1203). */
export async function generateDataKey(): Promise<DataKey> {
  const s = await cryptoReady();
  return s.randombytes_buf(KEY_BYTES) as DataKey;
}

/**
 * Securely zero a key/buffer in place (F1205). Call this the moment a key leaves
 * scope (e.g. on vault lock). Keys must never be logged or serialized in the clear.
 */
export function zeroKey(key: Uint8Array): void {
  // Overwrite without relying on libsodium being loaded (lock paths must be sync).
  key.fill(0);
}

/** Constant-time equality for secrets/MACs/fingerprints (F1208). */
export async function constantTimeEqual(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  if (a.length !== b.length) return false;
  const s = await cryptoReady();
  return s.memcmp(a, b);
}

// ── Key derivation (F1202) ──────────────────────────────────────────────────

function opsLimit(s: Sodium, strength: KdfStrength): number {
  if (strength === 'interactive') return s.crypto_pwhash_OPSLIMIT_INTERACTIVE;
  if (strength === 'sensitive') return s.crypto_pwhash_OPSLIMIT_SENSITIVE;
  return s.crypto_pwhash_OPSLIMIT_MODERATE;
}
function memLimit(s: Sodium, strength: KdfStrength): number {
  if (strength === 'interactive') return s.crypto_pwhash_MEMLIMIT_INTERACTIVE;
  if (strength === 'sensitive') return s.crypto_pwhash_MEMLIMIT_SENSITIVE;
  return s.crypto_pwhash_MEMLIMIT_MODERATE;
}

/**
 * Derive the master key from a passphrase + salt using Argon2id (F1202).
 * The same passphrase + salt + params always yields the same key, which is how
 * unlock works; change any input and the key diverges.
 */
export async function deriveMasterKey(
  passphrase: string,
  salt: Uint8Array,
  params: CryptoParams = CURRENT_CRYPTO_PARAMS,
): Promise<MasterKey> {
  const s = await cryptoReady();
  const key = s.crypto_pwhash(
    KEY_BYTES,
    passphrase,
    salt,
    opsLimit(s, params.kdfStrength),
    memLimit(s, params.kdfStrength),
    s.crypto_pwhash_ALG_ARGON2ID13,
  );
  return key as MasterKey;
}

// ── Authenticated encryption (F1204) ────────────────────────────────────────

/**
 * A sealed, self-describing ciphertext. Serialize with {@link packSealed} for
 * storage; the version + algorithm id are part of the bytes so old data stays
 * readable across parameter upgrades (F1209).
 */
export interface Sealed {
  readonly v: number;
  readonly alg: typeof ALG_XCHACHA20POLY1305;
  readonly nonce: Uint8Array;
  readonly ct: Uint8Array;
}

/**
 * Encrypt `plaintext` under `key` with optional associated data (F1204). A fresh
 * random nonce is generated internally — callers cannot supply one, so nonce
 * reuse is impossible by construction (F1206).
 */
export async function seal(
  plaintext: Uint8Array,
  key: SecretKey,
  associatedData?: Uint8Array,
): Promise<Sealed> {
  const s = await cryptoReady();
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = s.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    associatedData ?? null,
    null,
    nonce,
    key,
  );
  return { v: CURRENT_CRYPTO_PARAMS.version, alg: ALG_XCHACHA20POLY1305, nonce, ct };
}

/**
 * Decrypt and verify a sealed box (F1204). Throws if the key is wrong, the
 * associated data doesn't match, or the ciphertext was tampered with.
 */
export async function open(
  sealed: Sealed,
  key: SecretKey,
  associatedData?: Uint8Array,
): Promise<Uint8Array> {
  const s = await cryptoReady();
  if (sealed.alg !== ALG_XCHACHA20POLY1305) {
    throw new Error(`unsupported AEAD algorithm id ${String(sealed.alg)}`);
  }
  return s.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    sealed.ct,
    associatedData ?? null,
    sealed.nonce,
    key,
  );
}

// ── Key hierarchy: wrap / unwrap data keys (F1203) ──────────────────────────

/**
 * Wrap (encrypt) a data key under the master key (F1203). Passphrase changes
 * only re-wrap data keys — content never needs re-encryption (F1223).
 */
export async function wrapDataKey(dataKey: DataKey, masterKey: MasterKey): Promise<Sealed> {
  return seal(dataKey, masterKey);
}

/** Unwrap a data key with the master key. Throws on a wrong master key. */
export async function unwrapDataKey(wrapped: Sealed, masterKey: MasterKey): Promise<DataKey> {
  const raw = await open(wrapped, masterKey);
  return raw as DataKey;
}

// ── Envelope serialization ──────────────────────────────────────────────────
//
// Wire format (compact, self-describing):
//   [version: 1 byte][alg: 1 byte][nonce length: 1 byte][nonce...][ct...]

/** Serialize a sealed box to a single byte array for storage. */
export function packSealed(sealed: Sealed): Uint8Array {
  const out = new Uint8Array(3 + sealed.nonce.length + sealed.ct.length);
  out[0] = sealed.v & 0xff;
  out[1] = sealed.alg;
  out[2] = sealed.nonce.length & 0xff;
  out.set(sealed.nonce, 3);
  out.set(sealed.ct, 3 + sealed.nonce.length);
  return out;
}

/** Parse a serialized sealed box back into its structured form. */
export function unpackSealed(bytes: Uint8Array): Sealed {
  if (bytes.length < 3) throw new Error('sealed envelope too short');
  const v = bytes[0]!;
  const alg = bytes[1]!;
  const nonceLen = bytes[2]!;
  if (alg !== ALG_XCHACHA20POLY1305) throw new Error(`unsupported algorithm id ${String(alg)}`);
  if (bytes.length < 3 + nonceLen) throw new Error('sealed envelope truncated');
  const nonce = bytes.slice(3, 3 + nonceLen);
  const ct = bytes.slice(3 + nonceLen);
  return { v, alg: ALG_XCHACHA20POLY1305, nonce, ct };
}

// ── Fingerprints (F1227, device verification) ───────────────────────────────

/**
 * A short, human-comparable fingerprint of a key for out-of-band device
 * verification (F1227). Never reveals the key — it's a one-way hash.
 */
export async function keyFingerprint(key: SecretKey): Promise<string> {
  const s = await cryptoReady();
  const hash = s.crypto_generichash(16, key, null);
  return s
    .to_hex(hash)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

// ── Encoding helpers ────────────────────────────────────────────────────────

export async function toBase64(bytes: Uint8Array): Promise<string> {
  const s = await cryptoReady();
  return s.to_base64(bytes, s.base64_variants.ORIGINAL);
}
export async function fromBase64(text: string): Promise<Uint8Array> {
  const s = await cryptoReady();
  return s.from_base64(text, s.base64_variants.ORIGINAL);
}
export async function utf8ToBytes(text: string): Promise<Uint8Array> {
  const s = await cryptoReady();
  return s.from_string(text);
}
export async function bytesToUtf8(bytes: Uint8Array): Promise<string> {
  const s = await cryptoReady();
  return s.to_string(bytes);
}
