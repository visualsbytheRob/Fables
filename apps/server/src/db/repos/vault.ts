import { conflict, nowIso, type KdfStrength } from '@fables/core';
import type { Db } from '../connection.js';

/** The persisted vault configuration. Holds no key material in usable form. */
export interface VaultConfig {
  salt: Uint8Array;
  wrappedDek: Uint8Array;
  paramsVersion: number;
  kdfStrength: KdfStrength;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  salt: Buffer;
  wrapped_dek: Buffer;
  params_version: number;
  kdf_strength: string;
  created_at: string;
  updated_at: string;
}

function toConfig(row: Row): VaultConfig {
  return {
    salt: new Uint8Array(row.salt),
    wrappedDek: new Uint8Array(row.wrapped_dek),
    paramsVersion: row.params_version,
    kdfStrength: row.kdf_strength as KdfStrength,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function vaultRepo(db: Db) {
  return {
    /** The vault config, or null if no vault has been created yet. */
    get(): VaultConfig | null {
      const row = db.prepare('SELECT * FROM vault WHERE id = 1').get() as Row | undefined;
      return row ? toConfig(row) : null;
    },

    exists(): boolean {
      return db.prepare('SELECT 1 FROM vault WHERE id = 1').get() !== undefined;
    },

    /** Create the (single) vault config row. Throws if one already exists. */
    create(input: {
      salt: Uint8Array;
      wrappedDek: Uint8Array;
      paramsVersion: number;
      kdfStrength: KdfStrength;
    }): VaultConfig {
      if (this.exists()) throw conflict('vault already exists');
      const now = nowIso();
      db.prepare(
        `INSERT INTO vault (id, salt, wrapped_dek, params_version, kdf_strength, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
      ).run(
        Buffer.from(input.salt),
        Buffer.from(input.wrappedDek),
        input.paramsVersion,
        input.kdfStrength,
        now,
        now,
      );
      return this.get()!;
    },

    /**
     * Re-wrap: replace the salt + wrapped data key (passphrase change, F1223).
     * The data key itself is unchanged, so content never needs re-encryption.
     */
    rewrap(input: {
      salt: Uint8Array;
      wrappedDek: Uint8Array;
      paramsVersion: number;
      kdfStrength: KdfStrength;
    }): void {
      db.prepare(
        `UPDATE vault SET salt = ?, wrapped_dek = ?, params_version = ?, kdf_strength = ?, updated_at = ?
         WHERE id = 1`,
      ).run(
        Buffer.from(input.salt),
        Buffer.from(input.wrappedDek),
        input.paramsVersion,
        input.kdfStrength,
        nowIso(),
      );
    },

    /** Permanently delete the vault config (full wipe, F1281). */
    destroy(): void {
      db.prepare('DELETE FROM vault WHERE id = 1').run();
    },
  };
}
