import type { Migration } from './index.js';

export const migration002Stories: Migration = {
  id: 2,
  name: 'stories',
  sql: /* sql */ `
    CREATE TABLE stories (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      entry_file  TEXT NOT NULL DEFAULT 'main.fable',
      status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'valid', 'broken')),
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE scenes (
      id         TEXT PRIMARY KEY,
      story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      path       TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (story_id, path)
    );

    CREATE TABLE entities (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL CHECK (type IN ('character', 'place', 'item', 'faction', 'custom')),
      name       TEXT NOT NULL,
      aliases    TEXT NOT NULL DEFAULT '[]',
      fields     TEXT NOT NULL DEFAULT '{}',
      note_id    TEXT REFERENCES notes(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_entities_type ON entities(type);

    CREATE TABLE links (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL CHECK (kind IN ('wikilink', 'mention', 'binding', 'relation')),
      source_type TEXT NOT NULL,
      source_id   TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id   TEXT NOT NULL,
      position    INTEGER,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX idx_links_source ON links(source_type, source_id);
    CREATE INDEX idx_links_target ON links(target_type, target_id);
  `,
};
