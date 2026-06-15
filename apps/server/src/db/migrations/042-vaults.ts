import type { Migration } from './index.js';

/**
 * Vault registry (Epic 20, F1901–F1909).
 *
 *   vaults  a named, on-disk vault (its own data dir). Exactly one is active at
 *           a time. Per-vault settings are isolated (JSON blob), each vault
 *           tracks its own encryption state (F1907) and can be flagged for
 *           opt-in cross-vault search (F1904) or moved to cold storage (F1908).
 *
 * The registry itself is metadata held in the primary DB; switching the live
 * connection to a vault's data dir is the boot/runtime concern, not this table.
 */
export const migration042Vaults: Migration = {
  id: 42,
  name: 'vaults',
  sql: /* sql */ `
    CREATE TABLE vaults (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL UNIQUE,
      data_dir    TEXT NOT NULL,
      template    TEXT NOT NULL DEFAULT 'blank',
      encryption  TEXT NOT NULL DEFAULT 'none',
      federated   INTEGER NOT NULL DEFAULT 0,
      archived    INTEGER NOT NULL DEFAULT 0,
      is_active   INTEGER NOT NULL DEFAULT 0,
      settings    TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_vaults_active ON vaults (is_active) WHERE is_active = 1;
  `,
};
