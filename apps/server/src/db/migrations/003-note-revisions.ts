import type { Migration } from './index.js';

export const migration003NoteRevisions: Migration = {
  id: 3,
  name: 'note-revisions',
  sql: /* sql */ `
    CREATE TABLE note_revisions (
      note_id      TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      rev          INTEGER NOT NULL,
      title        TEXT NOT NULL,
      body         TEXT NOT NULL,
      word_count   INTEGER NOT NULL,
      char_count   INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      PRIMARY KEY (note_id, rev)
    );
    CREATE INDEX idx_note_revisions_created ON note_revisions(note_id, created_at);

    -- Distinguish links created by inline #tag parsing (resynced on every save)
    -- from manual links (bulk tag ops), so a save never strips manual tags.
    ALTER TABLE note_tags ADD COLUMN via_body INTEGER NOT NULL DEFAULT 0;
  `,
};
