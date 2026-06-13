import type { Migration } from './index.js';

/**
 * CRDT collaboration tables (F1101–F1140).
 *
 * `crdt_docs`: stores the persisted Y.Doc state for each note.
 *   - doc_id: note ID (FK → notes.id with CASCADE DELETE)
 *   - state: binary Yjs state update (mergeUpdates result)
 *   - schema_version: CRDT_SCHEMA_VERSION for migration detection
 *   - update_count: tracks individual updates since last compaction
 *   - updated_at: last persistence flush timestamp
 *
 * `crdt_updates`: individual incremental updates pending compaction.
 *   When update_count exceeds CRDT_COMPACTION_THRESHOLD the server
 *   merges all rows into crdt_docs.state and deletes the rows.
 *
 * `collab_rooms`: active room metadata for metrics / horizontal readiness.
 *   - doc_id: note ID
 *   - peer_count: current connected peer count
 *   - created_at: room open time
 *   - last_activity_at: last update received (for idle timeout)
 */
export const migration018Crdt: Migration = {
  id: 18,
  name: 'crdt',
  sql: /* sql */ `
    CREATE TABLE crdt_docs (
      doc_id          TEXT NOT NULL PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
      state           BLOB NOT NULL DEFAULT (X''),
      schema_version  INTEGER NOT NULL DEFAULT 1,
      update_count    INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE crdt_updates (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      update_data BLOB NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX idx_crdt_updates_doc ON crdt_updates (doc_id, id);

    CREATE TABLE collab_rooms (
      doc_id           TEXT NOT NULL PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
      peer_count       INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_activity_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `,
};
