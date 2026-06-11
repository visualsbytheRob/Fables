import type { Migration } from './index.js';

export const migration001Notes: Migration = {
  id: 1,
  name: 'notes',
  sql: /* sql */ `
    CREATE TABLE notebooks (
      id          TEXT PRIMARY KEY,
      parent_id   TEXT REFERENCES notebooks(id) ON DELETE SET NULL,
      name        TEXT NOT NULL,
      icon        TEXT,
      color       TEXT,
      archived    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE notes (
      id          TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id),
      title       TEXT NOT NULL DEFAULT '',
      body        TEXT NOT NULL DEFAULT '',
      pinned      INTEGER NOT NULL DEFAULT 0,
      trashed_at  TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      rev         INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_notes_notebook ON notes(notebook_id) WHERE trashed_at IS NULL;
    CREATE INDEX idx_notes_updated ON notes(updated_at);

    CREATE TABLE tags (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      color      TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE note_tags (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    );
  `,
};
