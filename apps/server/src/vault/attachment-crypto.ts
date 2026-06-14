/**
 * Encrypted attachment store (F1214).
 *
 * When the vault is unlocked, attachment bytes written to disk are sealed
 * under the vault's data key; on read they are opened (decrypted + verified).
 * When the vault is absent or locked, attachments are stored and served as
 * plaintext (the pre-vault behaviour).
 *
 * File-on-disk layout (encrypted):
 *   [4-byte magic "FAE1"][packed Sealed envelope bytes]
 *
 * The 4-byte magic lets the read path detect whether a file was written
 * before encryption was enabled, so legacy plaintext blobs continue to be
 * served correctly alongside new ciphertext ones.
 *
 * The content hash used as the file address is computed over the PLAINTEXT,
 * so content-addressed deduplication continues to work across both modes.
 * Encrypted files live at <hash>.enc in the same shard directory; plaintext
 * files continue to live at the bare <hash> path.
 *
 * For binary blobs we call sealSync / openSync directly (not the string-oriented
 * field codec), so there is no unnecessary base64 round-trip.  To access the
 * data key without reaching into VaultService's private field, we expose a thin
 * `vaultBinaryCodec` helper that the VaultService instance opts into via a
 * module-level WeakMap populated by `registerVaultForBinaryCodec`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { packSealed, sealSync, openSync, unpackSealed } from '@fables/core';
import type { DataKey } from '@fables/core';
import type { VaultService } from './service.js';

// ── Data-key registry (avoids mutating VaultService) ─────────────────────────

/**
 * WeakMap from VaultService instance → current data key getter.
 * Populated by `registerVaultDataKeyGetter` which is called once during
 * the new vault module initialisation.  Using a WeakMap means the entry
 * is garbage-collected together with the VaultService instance.
 */
const dataKeyGetters = new WeakMap<VaultService, () => DataKey | null>();

/**
 * Register a data-key getter for a VaultService instance.  Call this once
 * after constructing the VaultService, passing a closure that returns the
 * current (possibly null) data key.
 *
 * This is used by the encrypted-attachment module to seal / open binary blobs
 * without reading VaultService's private `dek` field.
 */
export function registerVaultDataKeyGetter(
  vault: VaultService,
  getter: () => DataKey | null,
): void {
  dataKeyGetters.set(vault, getter);
}

function getDataKey(vault: VaultService): DataKey | null {
  return dataKeyGetters.get(vault)?.() ?? null;
}

// ── Magic header ──────────────────────────────────────────────────────────────

// 4-byte magic that identifies an encrypted attachment file ("FAE1").
const MAGIC = Buffer.from([0x46, 0x41, 0x45, 0x31]);
const MAGIC_LEN = 4;

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * On-disk path for the encrypted version of the attachment identified by
 * `hash`.  Plaintext files use the bare `<hash>` path (existing convention);
 * encrypted files add the `.enc` suffix in the same shard directory.
 */
export function encAttachmentPath(dataDir: string, hash: string): string {
  return path.join(dataDir, 'attachments', hash.slice(0, 2), `${hash}.enc`);
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Save attachment bytes, encrypting them when the vault is unlocked (F1214).
 *
 * - Vault unlocked  → writes `<hash>.enc` (MAGIC + sealed ciphertext).
 *   A legacy plaintext `<hash>` file, if already present, is left untouched.
 * - Vault locked / absent → writes plaintext `<hash>` (pre-vault behaviour).
 *
 * Returns `true` when the file was freshly written, `false` when the file
 * already existed on disk (idempotent, matching the original store.ts behaviour).
 */
export function saveAttachmentFileEncrypted(
  dataDir: string,
  hash: string,
  content: Buffer,
  vault: VaultService,
): boolean {
  const dek = getDataKey(vault);

  if (dek === null) {
    // Vault locked/absent — plaintext path (existing store.ts behaviour).
    const dest = path.join(dataDir, 'attachments', hash.slice(0, 2), hash);
    if (fs.existsSync(dest)) return false;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, dest);
    return true;
  }

  // Vault unlocked — encrypt under the data key.
  const encPath = encAttachmentPath(dataDir, hash);
  if (fs.existsSync(encPath)) return false;
  fs.mkdirSync(path.dirname(encPath), { recursive: true });

  const sealed = sealSync(new Uint8Array(content), dek);
  const packed = packSealed(sealed);
  const fileBytes = Buffer.concat([MAGIC, Buffer.from(packed)]);

  const tmp = `${encPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, fileBytes);
  fs.renameSync(tmp, encPath);
  return true;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read an attachment file, decrypting if it was stored encrypted (F1214).
 *
 * Resolution order:
 *   1. `<hash>.enc` exists and vault is unlocked → decrypt and return.
 *   2. `<hash>.enc` exists and vault is locked   → throws (code: FORBIDDEN).
 *   3. `<hash>` (plaintext) exists               → return as-is.
 *   4. Neither exists                             → returns null.
 */
export function readAttachmentFileDecrypted(
  dataDir: string,
  hash: string,
  vault: VaultService,
): Buffer | null {
  const encPath = encAttachmentPath(dataDir, hash);
  const plainPath = path.join(dataDir, 'attachments', hash.slice(0, 2), hash);

  if (fs.existsSync(encPath)) {
    const dek = getDataKey(vault);
    if (dek === null) {
      throw Object.assign(
        new Error('attachment is encrypted — vault must be unlocked to read it'),
        { code: 'FORBIDDEN' },
      );
    }
    const fileBytes = fs.readFileSync(encPath);
    if (fileBytes.length < MAGIC_LEN) {
      throw new Error(`encrypted attachment file too short: ${encPath}`);
    }
    const magic = fileBytes.subarray(0, MAGIC_LEN);
    if (!magic.equals(MAGIC)) {
      throw new Error(`encrypted attachment has unknown magic bytes: ${encPath}`);
    }
    const packedBuf = fileBytes.subarray(MAGIC_LEN);
    const sealed = unpackSealed(new Uint8Array(packedBuf));
    const plain = openSync(sealed, dek);
    return Buffer.from(plain);
  }

  if (fs.existsSync(plainPath)) {
    return fs.readFileSync(plainPath);
  }

  return null;
}

/**
 * Returns whether any on-disk file (encrypted or plaintext) exists for `hash`.
 */
export function attachmentFileExists(dataDir: string, hash: string): boolean {
  const encPath = encAttachmentPath(dataDir, hash);
  const plainPath = path.join(dataDir, 'attachments', hash.slice(0, 2), hash);
  return fs.existsSync(encPath) || fs.existsSync(plainPath);
}
