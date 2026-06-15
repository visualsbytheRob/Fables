import type { Migration } from './index.js';

/**
 * Bulk-operation journal (Epic 20, F1958).
 *
 *   bulk_journal  one row per applied bulk operation, holding the op, a full
 *                 before-snapshot of every touched note and the ids it created,
 *                 so any batch can be replayed or reversed. `reversed` marks an
 *                 entry that has already been undone.
 */
export const migration044BulkJournal: Migration = {
  id: 44,
  name: 'bulk-journal',
  sql: /* sql */ `
    CREATE TABLE bulk_journal (
      id         TEXT PRIMARY KEY,
      op         TEXT NOT NULL,
      summary    TEXT NOT NULL,
      before     TEXT NOT NULL,
      added_ids  TEXT NOT NULL,
      affected   INTEGER NOT NULL DEFAULT 0,
      reversed   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_bulk_journal_created ON bulk_journal (created_at);
  `,
};
