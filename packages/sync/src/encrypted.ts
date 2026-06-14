/**
 * Encrypted sync payloads (F1251, F1252).
 *
 * Lets a server store and relay collaboration data for an encrypted document
 * without ever seeing plaintext:
 *   - F1251: op-log payloads are sealed before they leave the client, so the
 *     server's op store holds ciphertext only.
 *   - F1252: Yjs CRDT updates for an encrypted doc are sealed the same way, so
 *     the collab relay forwards opaque blobs between peers that share the key.
 *
 * The server is a dumb pipe/store here: it can order, dedupe, and relay these
 * blobs (the metadata it needs stays plaintext) but cannot read their contents.
 * Built on the audited crypto core — XChaCha20-Poly1305 with an internal random
 * nonce per payload, so identical updates never produce identical ciphertext.
 */

import {
  bytesToUtf8,
  fromBase64,
  open,
  packSealed,
  seal,
  toBase64,
  unpackSealed,
  utf8ToBytes,
  type SecretKey,
} from '@fables/core';

/** Seal a binary CRDT update (or any binary sync payload) for relay/storage. */
export async function encryptUpdate(update: Uint8Array, key: SecretKey): Promise<Uint8Array> {
  return packSealed(await seal(update, key));
}

/** Open a sealed binary update. Throws if the key is wrong or the bytes were tampered with. */
export async function decryptUpdate(ciphertext: Uint8Array, key: SecretKey): Promise<Uint8Array> {
  return open(unpackSealed(ciphertext), key);
}

/**
 * Seal a textual op-log payload (e.g. a JSON-encoded operation) to a base64
 * string suitable for a TEXT column the server treats as opaque (F1251).
 */
export async function encryptOpPayload(payload: string, key: SecretKey): Promise<string> {
  return toBase64(packSealed(await seal(await utf8ToBytes(payload), key)));
}

/** Open a base64 op-log payload produced by {@link encryptOpPayload}. */
export async function decryptOpPayload(ciphertextB64: string, key: SecretKey): Promise<string> {
  return bytesToUtf8(await open(unpackSealed(await fromBase64(ciphertextB64)), key));
}

/**
 * True if a stored payload looks like ciphertext we produced (self-describing
 * envelope marker). Lets a mixed store tell encrypted rows from plaintext ones.
 */
export function isEncryptedPayload(bytes: Uint8Array): boolean {
  // packSealed lays out [version][alg=1][nonceLen=24]… — a cheap structural check.
  return bytes.length > 3 && bytes[1] === 1 && bytes[2] === 24;
}
