import type { Migration } from './index.js';

/**
 * Day 6 story project model (F501–F510) + save slots (F462–F463).
 *
 * - `stories` grows settings JSON (cover, theme, seed mode), per-story build
 *   diagnostics + error/warning counts (compile-on-save, F504/F505), and a
 *   template flag (F508).
 * - `story_releases` stores named source snapshots (F506) — bytecode is
 *   deterministic, so releases keep sources and recompile on demand.
 * - `story_saves` holds named slots and the autosave ring buffer (F462/F463).
 */
export const migration008StoryProjects: Migration = {
  id: 8,
  name: 'story-projects',
  sql: /* sql */ `
    ALTER TABLE stories ADD COLUMN settings      TEXT    NOT NULL DEFAULT '{}';
    ALTER TABLE stories ADD COLUMN diagnostics   TEXT    NOT NULL DEFAULT '[]';
    ALTER TABLE stories ADD COLUMN error_count   INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE stories ADD COLUMN warning_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE stories ADD COLUMN built_at      TEXT;
    ALTER TABLE stories ADD COLUMN is_template   INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE story_releases (
      id         TEXT PRIMARY KEY,
      story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      status     TEXT NOT NULL CHECK (status IN ('valid', 'broken')),
      entry_file TEXT NOT NULL,
      settings   TEXT NOT NULL DEFAULT '{}',
      files      TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE (story_id, name)
    );
    CREATE INDEX idx_story_releases_story ON story_releases(story_id, created_at);

    CREATE TABLE story_saves (
      id         TEXT PRIMARY KEY,
      story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL CHECK (kind IN ('slot', 'auto')),
      name       TEXT NOT NULL DEFAULT '',
      state      TEXT NOT NULL,
      turn       INTEGER NOT NULL DEFAULT 0,
      scene      TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_story_saves_story ON story_saves(story_id, kind, created_at);
    CREATE UNIQUE INDEX idx_story_saves_slot_name
      ON story_saves(story_id, name) WHERE kind = 'slot';
  `,
};
