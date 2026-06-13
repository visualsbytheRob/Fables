import type { Migration } from './index.js';

/**
 * Encrypted vault configuration (F1211–F1220).
 *
 * Single-row table holding everything needed to unlock the vault — but never the
 * passphrase or the data key itself. The data key (DEK) is stored only as
 * ciphertext, wrapped under the master key that is derived from the passphrase at
 * unlock time and never persisted. With the disk at rest, an attacker sees the
 * salt and a wrapped key whose AEAD tag they cannot forge: no content, no key.
 *
 * `vault` (id is pinned to 1 so there is exactly one vault config row):
 *   - id:             always 1 (CHECK enforced)
 *   - salt:           Argon2id salt for deriving the master key (BLOB)
 *   - wrapped_dek:    the data key sealed under the master key, packed envelope (BLOB)
 *   - params_version: crypto parameter version that wrote this row (F1209)
 *   - kdf_strength:   'interactive' | 'moderate' | 'sensitive' (Argon2id cost preset)
 *   - created_at, updated_at: ISO timestamps
 *
 * Metadata boundary (F1212): note ids, notebook structure, and timestamps stay
 * plaintext so the app can list/sort/sync without unlocking; only note titles and
 * bodies are encrypted at rest (see docs/security/privacy-data-flow.md).
 */
export const migration020Vault: Migration = {
  id: 20,
  name: 'vault',
  sql: /* sql */ `
    CREATE TABLE vault (
      id             INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      salt           BLOB    NOT NULL,
      wrapped_dek    BLOB    NOT NULL,
      params_version INTEGER NOT NULL,
      kdf_strength   TEXT    NOT NULL,
      created_at     TEXT    NOT NULL,
      updated_at     TEXT    NOT NULL
    );
  `,
};
