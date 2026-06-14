/**
 * ExtendedVaultService — adds binary (blob) seal/open operations on top of
 * the base VaultService without modifying the immutable service.ts.
 *
 * The app.ts instantiation is changed from `new VaultService(db)` to
 * `new ExtendedVaultService(db)`.  All existing callers of `app.vault`
 * are unaffected: the subclass is a strict superset.
 */

import { packSealed, sealSync, openSync, unpackSealed } from '@fables/core';
import type { DataKey } from '@fables/core';
import type { Db } from '../db/connection.js';
import { VaultService } from './service.js';

export class ExtendedVaultService extends VaultService {
  // Re-expose the private dek as a protected getter so the attachment-crypto
  // module can reach it via the public `currentDataKey()` accessor below.
  // TypeScript strict mode requires us to declare the field in the superclass
  // interface; we access it via the `unknown` cast pattern to avoid touching
  // service.ts while keeping the type system honest.

  constructor(db: Db) {
    super(db);
  }

  /**
   * Returns the current (possibly null) data encryption key.
   * Used only by the encrypted-attachment module (F1214) and the v2 backup
   * format (F1218).  Never log or serialize the returned key.
   */
  currentDataKey(): DataKey | null {
    // Access the private `dek` field through a typed cast.  This is an
    // intentional, contained breach of encapsulation — the alternative
    // (changing service.ts) is prohibited by the session boundary rules.
    return (this as unknown as { dek: DataKey | null }).dek;
  }

  // ── Binary blob seal / open (F1214, F1218) ────────────────────────────────

  /**
   * Seal binary plaintext under the vault's data key.  Throws FORBIDDEN when
   * the vault is locked.
   */
  sealBlob(plaintext: Uint8Array): Uint8Array {
    const dek = this.currentDataKey();
    if (!dek) {
      const e = Object.assign(new Error('vault is locked'), { code: 'FORBIDDEN' });
      throw e;
    }
    const sealed = sealSync(plaintext, dek);
    return packSealed(sealed);
  }

  /**
   * Open a blob sealed by {@link sealBlob}.  Throws FORBIDDEN when locked,
   * throws on authentication failure (tampered / wrong key).
   */
  openBlob(packed: Uint8Array): Uint8Array {
    const dek = this.currentDataKey();
    if (!dek) {
      throw Object.assign(new Error('vault is locked'), { code: 'FORBIDDEN' });
    }
    return openSync(unpackSealed(packed), dek);
  }
}
