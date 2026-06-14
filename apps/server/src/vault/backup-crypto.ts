/**
 * Encrypted backup envelope (.fablesbak v2, F1218).
 *
 * A v2 backup is just a v1 archive sealed whole under the vault's data key, with
 * a 4-byte `FBK2` magic prefix so the restore path can tell encrypted archives
 * from plaintext ones. The archive body (db + attachments) is opaque ciphertext
 * at rest; restoring it requires an unlocked vault.
 */

/** 4-byte magic identifying a v2 (encrypted) .fablesbak archive. */
export const BACKUP_V2_MAGIC = Buffer.from('FBK2', 'latin1');

/** True if `bytes` is a v2 encrypted backup envelope. */
export function isEncryptedBackup(bytes: Uint8Array): boolean {
  return (
    bytes.length >= BACKUP_V2_MAGIC.length &&
    Buffer.from(bytes.subarray(0, 4)).equals(BACKUP_V2_MAGIC)
  );
}

/** Prefix sealed archive bytes with the v2 magic for storage/download. */
export function wrapEncryptedBackup(sealed: Uint8Array): Buffer {
  return Buffer.concat([BACKUP_V2_MAGIC, Buffer.from(sealed)]);
}

/** Strip the v2 magic, returning the sealed inner bytes. */
export function unwrapEncryptedBackup(bytes: Uint8Array): Uint8Array {
  return bytes.subarray(BACKUP_V2_MAGIC.length);
}
