import type { Migration } from './index.js';

/**
 * Vault-import job tracking (F294, F297). One row per import run; the import
 * loop updates `processed` between batches so the web UI can poll progress.
 * `errors` is a JSON array of `{ file, message }` — per-file failures never
 * abort the run.
 */
export const migration007ImportJobs: Migration = {
  id: 7,
  name: 'import-jobs',
  sql: /* sql */ `
    CREATE TABLE import_jobs (
      id          TEXT PRIMARY KEY,
      path        TEXT NOT NULL,
      status      TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
      total       INTEGER NOT NULL DEFAULT 0,
      processed   INTEGER NOT NULL DEFAULT 0,
      imported    INTEGER NOT NULL DEFAULT 0,
      merged      INTEGER NOT NULL DEFAULT 0,
      renamed     INTEGER NOT NULL DEFAULT 0,
      skipped     INTEGER NOT NULL DEFAULT 0,
      attachments INTEGER NOT NULL DEFAULT 0,
      errors      TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `,
};
