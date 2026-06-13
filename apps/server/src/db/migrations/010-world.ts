import type { Migration } from './index.js';

/**
 * Day 7 fusion tables (F644, F684, F686, F683).
 *
 * - `playthroughs`      one row per (story, playthrough): binding mode
 *                       (live vs snapshot, F644), the sandbox flag (F686),
 *                       the frozen knowledge-state snapshot JSON, and
 *                       started/finished timestamps for the timeline (F651).
 * - `world_snapshots`   named captures of the entire entity field state
 *                       (F684); `entities` is a JSON array of
 *                       {id, type, name, fields}.
 * - `sandbox_entities`  per-playthrough field overlays: sandbox playthroughs
 *                       write here instead of mutating live entities (F686).
 * - `entity_mutations`  gains `kind` ('effect' | 'revert', F683) and
 *                       `sandbox` so reverts stay audited and sandbox writes
 *                       never pollute the world inspector.
 */
export const migration010World: Migration = {
  id: 10,
  name: 'world',
  sql: /* sql */ `
    CREATE TABLE playthroughs (
      story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      id          TEXT NOT NULL,
      mode        TEXT NOT NULL DEFAULT 'live' CHECK (mode IN ('live', 'snapshot')),
      sandbox     INTEGER NOT NULL DEFAULT 0,
      snapshot    TEXT,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      PRIMARY KEY (story_id, id)
    );

    CREATE TABLE world_snapshots (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      entities   TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE sandbox_entities (
      story_id       TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      playthrough_id TEXT NOT NULL,
      entity_id      TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      fields         TEXT NOT NULL DEFAULT '{}',
      updated_at     TEXT NOT NULL,
      PRIMARY KEY (story_id, playthrough_id, entity_id)
    );

    ALTER TABLE entity_mutations ADD COLUMN kind TEXT NOT NULL DEFAULT 'effect';
    ALTER TABLE entity_mutations ADD COLUMN sandbox INTEGER NOT NULL DEFAULT 0;
  `,
};
