import type { Migration } from './index.js';

export const migration004Attachments: Migration = {
  id: 4,
  name: 'attachments',
  sql: /* sql */ `
    CREATE TABLE attachments (
      id         TEXT PRIMARY KEY,
      note_id    TEXT REFERENCES notes(id) ON DELETE SET NULL,
      filename   TEXT NOT NULL,
      mime       TEXT NOT NULL,
      size       INTEGER NOT NULL,
      hash       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_attachments_note ON attachments(note_id);
    CREATE INDEX idx_attachments_hash ON attachments(hash);
  `,
};
