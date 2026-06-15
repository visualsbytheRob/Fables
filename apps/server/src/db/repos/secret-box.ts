/**
 * Secret-box config repository (Epic 13, F1242).
 *
 * Persists the secret-notes key path (migration 048): a salt + wrapped secret
 * data key, kept entirely separate from the vault config so the secret-note
 * passphrase is independent of the vault passphrase. Holds no usable key
 * material — only the wrapped DEK.
 */

import { nowIso, type KdfStrength } from '@fables/core';
import type { Db } from '../connection.js';

export interface SecretBoxConfig {
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

function toConfig(row: Row): SecretBoxConfig {
  return {
    salt: new Uint8Array(row.salt),
    wrappedDek: new Uint8Array(row.wrapped_dek),
    paramsVersion: row.params_version,
    kdfStrength: row.kdf_strength as KdfStrength,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function secretBoxRepo(db: Db) {
  return {
    get(): SecretBoxConfig | null {
      const row = db.prepare('SELECT * FROM secret_box WHERE id = 1').get() as Row | undefined;
      return row ? toConfig(row) : null;
    },

    exists(): boolean {
      return db.prepare('SELECT 1 FROM secret_box WHERE id = 1').get() !== undefined;
    },

    create(input: {
      salt: Uint8Array;
      wrappedDek: Uint8Array;
      paramsVersion: number;
      kdfStrength: KdfStrength;
    }): void {
      const now = nowIso();
      db.prepare(
        `INSERT INTO secret_box (id, salt, wrapped_dek, params_version, kdf_strength, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
      ).run(
        Buffer.from(input.salt),
        Buffer.from(input.wrappedDek),
        input.paramsVersion,
        input.kdfStrength,
        now,
        now,
      );
    },

    rewrap(input: {
      salt: Uint8Array;
      wrappedDek: Uint8Array;
      paramsVersion: number;
      kdfStrength: KdfStrength;
    }): void {
      db.prepare(
        `UPDATE secret_box SET salt = ?, wrapped_dek = ?, params_version = ?, kdf_strength = ?, updated_at = ?
         WHERE id = 1`,
      ).run(
        Buffer.from(input.salt),
        Buffer.from(input.wrappedDek),
        input.paramsVersion,
        input.kdfStrength,
        nowIso(),
      );
    },

    destroy(): void {
      db.prepare('DELETE FROM secret_box WHERE id = 1').run();
    },
  };
}
