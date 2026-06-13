import type { Migration } from './index.js';

/**
 * Day 7 entity/codex/effects tables (F601–F620, F631–F640).
 *
 * - `entity_schemas`        one row per entity type: user-editable field +
 *                           relation definitions (JSON), seeded with sensible
 *                           defaults for the built-in types (F602).
 * - `playthrough_encounters` met-tracking per (story, playthrough, entity)
 *                           with first-seen time and a counter (F613).
 * - `playthrough_reveals`   which entity fields a playthrough has unlocked —
 *                           the spoiler-safety source of truth (F616/F618).
 * - `entity_mutations`      audit trail of ENTITY_SET effects: old/new value
 *                           per field for the world inspector (F633-adjacent).
 * - `effect_events`         per-playthrough audit of every ingested VM host
 *                           effect (F640).
 * - `effect_batches`        idempotency keys with the stored response, so a
 *                           retried batch replays without re-applying (F638).
 */
export const migration009Entities: Migration = {
  id: 9,
  name: 'entities',
  sql: /* sql */ `
    CREATE TABLE entity_schemas (
      type       TEXT PRIMARY KEY CHECK (type IN ('character', 'place', 'item', 'faction', 'custom')),
      fields     TEXT NOT NULL DEFAULT '[]',
      relations  TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    INSERT INTO entity_schemas (type, fields, relations, updated_at) VALUES
      ('character',
       '[{"name":"health","fieldType":"number","default":100},{"name":"alive","fieldType":"bool","default":true},{"name":"role","fieldType":"string","default":""},{"name":"traits","fieldType":"list","default":[]}]',
       '[{"name":"ally-of","targetType":"character"},{"name":"enemy-of","targetType":"character"},{"name":"member-of","targetType":"faction"},{"name":"located-in","targetType":"place"}]',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      ('place',
       '[{"name":"region","fieldType":"string","default":""},{"name":"population","fieldType":"number","default":0},{"name":"discovered","fieldType":"bool","default":false},{"name":"features","fieldType":"list","default":[]}]',
       '[{"name":"located-in","targetType":"place"},{"name":"controlled-by","targetType":"faction"}]',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      ('item',
       '[{"name":"value","fieldType":"number","default":0},{"name":"description","fieldType":"string","default":""},{"name":"unique","fieldType":"bool","default":false},{"name":"tags","fieldType":"list","default":[]}]',
       '[{"name":"owned-by","targetType":"character"},{"name":"located-in","targetType":"place"}]',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      ('faction',
       '[{"name":"motto","fieldType":"string","default":""},{"name":"influence","fieldType":"number","default":0},{"name":"active","fieldType":"bool","default":true},{"name":"goals","fieldType":"list","default":[]}]',
       '[{"name":"ally-of","targetType":"faction"},{"name":"enemy-of","targetType":"faction"},{"name":"based-in","targetType":"place"}]',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      ('custom', '[]', '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

    CREATE TABLE playthrough_encounters (
      id             TEXT PRIMARY KEY,
      story_id       TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      playthrough_id TEXT NOT NULL,
      entity_id      TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      first_at       TEXT NOT NULL,
      count          INTEGER NOT NULL DEFAULT 1,
      UNIQUE (story_id, playthrough_id, entity_id)
    );
    CREATE INDEX idx_encounters_playthrough
      ON playthrough_encounters(story_id, playthrough_id);

    CREATE TABLE playthrough_reveals (
      id             TEXT PRIMARY KEY,
      story_id       TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      playthrough_id TEXT NOT NULL,
      entity_id      TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      field          TEXT NOT NULL,
      revealed_at    TEXT NOT NULL,
      UNIQUE (story_id, playthrough_id, entity_id, field)
    );
    CREATE INDEX idx_reveals_playthrough
      ON playthrough_reveals(story_id, playthrough_id, entity_id);

    CREATE TABLE entity_mutations (
      id             TEXT PRIMARY KEY,
      story_id       TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      playthrough_id TEXT NOT NULL,
      entity_id      TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      field          TEXT NOT NULL,
      old_value      TEXT,
      new_value      TEXT,
      at             TEXT NOT NULL
    );
    CREATE INDEX idx_entity_mutations_playthrough
      ON entity_mutations(story_id, playthrough_id, at);
    CREATE INDEX idx_entity_mutations_entity ON entity_mutations(entity_id, at);

    CREATE TABLE effect_events (
      id             TEXT PRIMARY KEY,
      story_id       TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      playthrough_id TEXT NOT NULL,
      batch_key      TEXT NOT NULL,
      type           TEXT NOT NULL CHECK (type IN ('journal', 'entity_set', 'encounter', 'reveal')),
      payload        TEXT NOT NULL DEFAULT '{}',
      at             TEXT NOT NULL
    );
    CREATE INDEX idx_effect_events_playthrough
      ON effect_events(story_id, playthrough_id, at);

    CREATE TABLE effect_batches (
      id             TEXT PRIMARY KEY,
      story_id       TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      playthrough_id TEXT NOT NULL,
      batch_key      TEXT NOT NULL,
      result         TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      UNIQUE (story_id, batch_key)
    );
  `,
};
