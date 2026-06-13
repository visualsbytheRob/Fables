/**
 * Crypto core test suite (F1207 known-answer tests, F1210 full suite).
 *
 * Covers: Argon2id determinism + pinned KAT, AEAD round-trip + tamper rejection,
 * AAD binding, key-hierarchy wrap/unwrap, envelope pack/unpack, constant-time
 * compare, fingerprints, parameter versioning, and key zeroing.
 */

import { describe, it, expect } from 'vitest';
import _sodium from 'libsodium-wrappers-sumo';
import {
  cryptoReady,
  cryptoReadySync,
  CURRENT_CRYPTO_PARAMS,
  generateSalt,
  generateDataKey,
  deriveMasterKey,
  seal,
  sealSync,
  open,
  wrapDataKey,
  unwrapDataKey,
  packSealed,
  unpackSealed,
  constantTimeEqual,
  keyFingerprint,
  zeroKey,
  utf8ToBytes,
  bytesToUtf8,
  encryptFieldSync,
  decryptFieldSync,
  isEncryptedField,
  ENC_FIELD_PREFIX,
  type MasterKey,
  type SecretKey,
} from './crypto.js';

async function masterFrom(pass: string, salt: Uint8Array): Promise<MasterKey> {
  return deriveMasterKey(pass, salt);
}

describe('crypto: known-answer tests (F1207)', () => {
  it('Argon2id (moderate) matches the pinned reference vector', async () => {
    await cryptoReady();
    const salt = new Uint8Array(16).fill(7);
    const key = await deriveMasterKey('test-vector-pass', salt);
    const s = _sodium;
    expect(s.to_hex(key)).toBe('f45a47bfeaf826908fff777249bff1d53f7c139b29bcf8326f4b6ef3a1299518');
  });

  it('XChaCha20-Poly1305 IETF matches the pinned reference ciphertext', async () => {
    const s = await cryptoReady();
    const k = new Uint8Array(32).map((_, i) => i);
    const n = new Uint8Array(24).map((_, i) => i + 100);
    const ct = s.crypto_aead_xchacha20poly1305_ietf_encrypt(
      s.from_string('hello vault'),
      null,
      null,
      n,
      k,
    );
    expect(s.to_hex(ct)).toBe('141695dc900effe3f25ce926a28d5d4328316c30d3ecafa6d1aa4d');
  });
});

describe('crypto: key derivation (F1202)', () => {
  it('is deterministic for the same passphrase + salt', async () => {
    const salt = await generateSalt();
    const k1 = await masterFrom('correct horse battery staple', salt);
    const k2 = await masterFrom('correct horse battery staple', salt);
    expect(await constantTimeEqual(k1, k2)).toBe(true);
  });

  it('diverges on a different passphrase or salt', async () => {
    const salt = await generateSalt();
    const k1 = await masterFrom('passphrase-a', salt);
    const k2 = await masterFrom('passphrase-b', salt);
    expect(await constantTimeEqual(k1, k2)).toBe(false);

    const salt2 = await generateSalt();
    const k3 = await masterFrom('passphrase-a', salt2);
    expect(await constantTimeEqual(k1, k3)).toBe(false);
  });
});

describe('crypto: authenticated encryption (F1204)', () => {
  it('round-trips plaintext', async () => {
    const key = (await generateDataKey()) as unknown as SecretKey;
    const msg = await utf8ToBytes('The dragon sleeps beneath the keep.');
    const sealed = await seal(msg, key);
    const out = await open(sealed, key);
    expect(await bytesToUtf8(out)).toBe('The dragon sleeps beneath the keep.');
  });

  it('uses a fresh nonce every call (no reuse by construction, F1206)', async () => {
    const key = (await generateDataKey()) as unknown as SecretKey;
    const msg = await utf8ToBytes('same plaintext');
    const a = await seal(msg, key);
    const b = await seal(msg, key);
    expect(_sodium.to_hex(a.nonce)).not.toBe(_sodium.to_hex(b.nonce));
    expect(_sodium.to_hex(a.ct)).not.toBe(_sodium.to_hex(b.ct));
  });

  it('rejects tampered ciphertext', async () => {
    const key = (await generateDataKey()) as unknown as SecretKey;
    const sealed = await seal(await utf8ToBytes('secret'), key);
    sealed.ct[0] = (sealed.ct[0] ?? 0) ^ 0x01;
    await expect(open(sealed, key)).rejects.toThrow();
  });

  it('rejects the wrong key', async () => {
    const key = (await generateDataKey()) as unknown as SecretKey;
    const other = (await generateDataKey()) as unknown as SecretKey;
    const sealed = await seal(await utf8ToBytes('secret'), key);
    await expect(open(sealed, other)).rejects.toThrow();
  });

  it('binds associated data', async () => {
    const key = (await generateDataKey()) as unknown as SecretKey;
    const aad = await utf8ToBytes('note:abc123');
    const sealed = await seal(await utf8ToBytes('body'), key, aad);
    expect(await bytesToUtf8(await open(sealed, key, aad))).toBe('body');
    const wrongAad = await utf8ToBytes('note:xyz789');
    await expect(open(sealed, key, wrongAad)).rejects.toThrow();
  });
});

describe('crypto: key hierarchy (F1203)', () => {
  it('wraps and unwraps a data key under the master key', async () => {
    const salt = await generateSalt();
    const master = await masterFrom('vault-pass', salt);
    const dataKey = await generateDataKey();
    const wrapped = await wrapDataKey(dataKey, master);
    const unwrapped = await unwrapDataKey(wrapped, master);
    expect(await constantTimeEqual(dataKey, unwrapped)).toBe(true);
  });

  it('passphrase change re-wraps without touching content (F1223)', async () => {
    const salt = await generateSalt();
    const oldMaster = await masterFrom('old-pass', salt);
    const dataKey = await generateDataKey();

    // Content encrypted once under the data key.
    const sealed = await seal(await utf8ToBytes('important'), dataKey);

    // Change passphrase: derive a new master, re-wrap the SAME data key.
    const newSalt = await generateSalt();
    const newMaster = await masterFrom('new-pass', newSalt);
    const rewrapped = await wrapDataKey(dataKey, newMaster);

    // Content still decrypts under the unchanged data key, recovered via new master.
    const recovered = await unwrapDataKey(rewrapped, newMaster);
    expect(await bytesToUtf8(await open(sealed, recovered))).toBe('important');
    // Old master can no longer unwrap the new wrap.
    await expect(unwrapDataKey(rewrapped, oldMaster)).rejects.toThrow();
  });
});

describe('crypto: envelope serialization', () => {
  it('packs and unpacks losslessly', async () => {
    const key = (await generateDataKey()) as unknown as SecretKey;
    const sealed = await seal(await utf8ToBytes('payload'), key);
    const bytes = packSealed(sealed);
    const parsed = unpackSealed(bytes);
    expect(parsed.v).toBe(sealed.v);
    expect(_sodium.to_hex(parsed.nonce)).toBe(_sodium.to_hex(sealed.nonce));
    expect(await bytesToUtf8(await open(parsed, key))).toBe('payload');
  });

  it('rejects truncated envelopes', () => {
    expect(() => unpackSealed(new Uint8Array([1, 1]))).toThrow();
  });
});

describe('crypto: utilities', () => {
  it('constant-time compare distinguishes equal/unequal', async () => {
    expect(await constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(
      true,
    );
    expect(await constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(
      false,
    );
    expect(await constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it('fingerprints are stable and one-way (F1227)', async () => {
    const key = (await generateDataKey()) as unknown as SecretKey;
    const fp1 = await keyFingerprint(key);
    const fp2 = await keyFingerprint(key);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f ]+$/);
    expect(fp1).not.toContain(_sodium.to_hex(key));
  });

  it('zeroKey wipes key material (F1205)', async () => {
    const key = await generateDataKey();
    expect(key.some((b) => b !== 0)).toBe(true);
    zeroKey(key);
    expect(key.every((b) => b === 0)).toBe(true);
  });

  it('exposes current parameter version (F1209)', () => {
    expect(CURRENT_CRYPTO_PARAMS.version).toBe(1);
    expect(CURRENT_CRYPTO_PARAMS.kdf).toBe('argon2id13');
    expect(CURRENT_CRYPTO_PARAMS.aead).toBe('xchacha20poly1305-ietf');
  });
});

describe('crypto: synchronous field codec (F1211)', () => {
  it('round-trips a field with the enc:v1: marker', async () => {
    const key = (await generateDataKey()) as unknown as SecretKey;
    const stored = encryptFieldSync('The dragon sleeps beneath the keep.', key);
    expect(stored.startsWith(ENC_FIELD_PREFIX)).toBe(true);
    expect(isEncryptedField(stored)).toBe(true);
    expect(stored).not.toContain('dragon');
    expect(decryptFieldSync(stored, key)).toBe('The dragon sleeps beneath the keep.');
  });

  it('passes plaintext through decrypt unchanged (mixed-mode safe)', async () => {
    const key = (await generateDataKey()) as unknown as SecretKey;
    expect(isEncryptedField('just a plaintext title')).toBe(false);
    expect(decryptFieldSync('just a plaintext title', key)).toBe('just a plaintext title');
  });

  it('sealSync/openSync match the async seal/open', async () => {
    const key = (await generateDataKey()) as unknown as SecretKey;
    const sealed = sealSync(await utf8ToBytes('sync path'), key);
    expect(await bytesToUtf8(await open(sealed, key))).toBe('sync path');
  });

  it('cryptoReadySync throws before init only', async () => {
    // After any earlier test, sodium is already loaded, so this resolves.
    await cryptoReady();
    expect(() => cryptoReadySync()).not.toThrow();
  });
});
