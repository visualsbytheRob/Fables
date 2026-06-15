import type { Migration } from './index.js';

/**
 * Secret notes (Epic 13, F1241–F1250).
 *
 *   secret_box   the per-note encryption key path — a salt + wrapped secret data
 *                key, derived from a SECRET passphrase that is independent of the
 *                vault passphrase (F1242). Works even when the vault is plaintext.
 *   notes.secret marks a note whose title/body are stored encrypted under the
 *                secret data key. Such notes are excluded from search/exports/AI
 *                and from plugins by default (F1244, F1249).
 */
export const migration048SecretNotes: Migration = {
  id: 48,
  name: 'secret-notes',
  sql: /* sql */ `
    CREATE TABLE secret_box (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      salt           BLOB NOT NULL,
      wrapped_dek    BLOB NOT NULL,
      params_version INTEGER NOT NULL,
      kdf_strength   TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    ALTER TABLE notes ADD COLUMN secret INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX idx_notes_secret ON notes(secret) WHERE secret = 1;
  `,
};
