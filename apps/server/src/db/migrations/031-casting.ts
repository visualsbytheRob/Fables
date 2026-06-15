import type { Migration } from './index.js';

/**
 * Voice casting (Epic 17, F1611/F1616/F1617).
 *
 *   F1611  entity_voices: a voice assignment per entity (character → voice),
 *          carrying optional per-character rate/pitch (F1615).
 *   F1616  cast_sheets: a saved casting per story — narrator + default-character
 *          voices and the speaker→voice map, stored as one JSON document so the
 *          shape can evolve without further migrations. A null story_id row is a
 *          reusable casting template (F1617).
 */
export const migration031Casting: Migration = {
  id: 31,
  name: 'casting',
  sql: /* sql */ `
    CREATE TABLE entity_voices (
      entity_id  TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
      voice_id   TEXT NOT NULL,
      rate       REAL,
      pitch      REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE cast_sheets (
      id         TEXT PRIMARY KEY,
      story_id   TEXT,
      name       TEXT NOT NULL DEFAULT '',
      data       TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_cast_sheets_story ON cast_sheets (story_id);
  `,
};
