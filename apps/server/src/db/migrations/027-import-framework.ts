import type { Migration } from './index.js';

/**
 * Import framework: batches, artifacts, provenance, resume (F1405, F1407, F1408).
 *
 * `import_batches` is one row per import run from any source adapter. Every
 * artifact the run creates — note, notebook, or attachment — is recorded in
 * `import_artifacts` keyed by batch, which gives us three things at once:
 *
 *   - **Provenance** (F1407): a note's row carries its foreign `source` +
 *     `source_id`, so we always know where an imported note came from.
 *   - **Resume** (F1405): on restart we skip docs whose `source_id` already has a
 *     note artifact in the batch.
 *   - **Rollback** (F1408): deleting a batch's artifacts cleanly undoes the run.
 */
export const migration027ImportFramework: Migration = {
  id: 27,
  name: 'import-framework',
  sql: /* sql */ `
    CREATE TABLE import_batches (
      id         TEXT PRIMARY KEY,
      source     TEXT NOT NULL,
      status     TEXT NOT NULL CHECK (status IN ('running','done','failed','rolled_back')),
      doc_count  INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE import_artifacts (
      batch_id    TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL CHECK (kind IN ('note','notebook','attachment')),
      artifact_id TEXT NOT NULL,
      source      TEXT,
      source_id   TEXT,
      created_at  TEXT NOT NULL,
      PRIMARY KEY (batch_id, kind, artifact_id)
    );

    CREATE INDEX idx_import_artifacts_note
      ON import_artifacts (kind, artifact_id);
    CREATE INDEX idx_import_artifacts_source
      ON import_artifacts (batch_id, kind, source_id);
  `,
};
