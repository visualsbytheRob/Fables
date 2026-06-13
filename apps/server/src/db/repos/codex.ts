import { nowIso, type EntityId, type StoryId } from '@fables/core';
import type { Db } from '../connection.js';

/**
 * Codex + effects persistence (F611–F620, F631–F640): met-tracking,
 * revealed-fact rows, the ENTITY_SET mutation audit, the per-playthrough
 * effect audit, and idempotency records for batched ingestion.
 */

export interface Encounter {
  id: string;
  storyId: StoryId;
  playthroughId: string;
  entityId: EntityId;
  firstAt: string;
  count: number;
}

export interface Reveal {
  id: string;
  storyId: StoryId;
  playthroughId: string;
  entityId: EntityId;
  field: string;
  revealedAt: string;
}

export interface EntityMutation {
  id: string;
  storyId: StoryId;
  playthroughId: string;
  entityId: EntityId;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  at: string;
}

export interface EffectEvent {
  id: string;
  storyId: StoryId;
  playthroughId: string;
  batchKey: string;
  type: 'journal' | 'entity_set' | 'encounter' | 'reveal';
  payload: Record<string, unknown>;
  at: string;
}

const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;

interface EncounterRow {
  id: string;
  story_id: string;
  playthrough_id: string;
  entity_id: string;
  first_at: string;
  count: number;
}

const toEncounter = (r: EncounterRow): Encounter => ({
  id: r.id,
  storyId: r.story_id as StoryId,
  playthroughId: r.playthrough_id,
  entityId: r.entity_id as EntityId,
  firstAt: r.first_at,
  count: r.count,
});

export function codexRepo(db: Db) {
  return {
    /** Upsert: first sighting inserts, repeats bump the counter (F613). */
    recordEncounter(
      storyId: StoryId,
      playthroughId: string,
      entityId: EntityId,
    ): Encounter & { repeat: boolean } {
      const existing = db
        .prepare(
          `SELECT * FROM playthrough_encounters
           WHERE story_id = ? AND playthrough_id = ? AND entity_id = ?`,
        )
        .get(storyId, playthroughId, entityId) as EncounterRow | undefined;
      if (existing) {
        db.prepare('UPDATE playthrough_encounters SET count = count + 1 WHERE id = ?').run(
          existing.id,
        );
        return { ...toEncounter(existing), count: existing.count + 1, repeat: true };
      }
      const row: EncounterRow = {
        id: newId('enc'),
        story_id: storyId,
        playthrough_id: playthroughId,
        entity_id: entityId,
        first_at: nowIso(),
        count: 1,
      };
      db.prepare(
        `INSERT INTO playthrough_encounters (id, story_id, playthrough_id, entity_id, first_at, count)
         VALUES (?, ?, ?, ?, ?, 1)`,
      ).run(row.id, row.story_id, row.playthrough_id, row.entity_id, row.first_at);
      return { ...toEncounter(row), repeat: false };
    },

    listEncounters(storyId: StoryId, playthroughId: string): Encounter[] {
      const rows = db
        .prepare(
          `SELECT * FROM playthrough_encounters
           WHERE story_id = ? AND playthrough_id = ? ORDER BY first_at, rowid`,
        )
        .all(storyId, playthroughId) as EncounterRow[];
      return rows.map(toEncounter);
    },

    /** Idempotent: revealing an already-revealed field is a no-op (F616). */
    recordReveal(
      storyId: StoryId,
      playthroughId: string,
      entityId: EntityId,
      field: string,
    ): { revealed: boolean } {
      const changed = db
        .prepare(
          `INSERT INTO playthrough_reveals (id, story_id, playthrough_id, entity_id, field, revealed_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (story_id, playthrough_id, entity_id, field) DO NOTHING`,
        )
        .run(newId('rev'), storyId, playthroughId, entityId, field, nowIso()).changes;
      return { revealed: changed === 1 };
    },

    listReveals(storyId: StoryId, playthroughId: string): Reveal[] {
      const rows = db
        .prepare(
          `SELECT * FROM playthrough_reveals
           WHERE story_id = ? AND playthrough_id = ? ORDER BY revealed_at, rowid`,
        )
        .all(storyId, playthroughId) as {
        id: string;
        story_id: string;
        playthrough_id: string;
        entity_id: string;
        field: string;
        revealed_at: string;
      }[];
      return rows.map((r) => ({
        id: r.id,
        storyId: r.story_id as StoryId,
        playthroughId: r.playthrough_id,
        entityId: r.entity_id as EntityId,
        field: r.field,
        revealedAt: r.revealed_at,
      }));
    },

    // ── mutation audit (F633-adjacent world inspector) ──────────────────────

    recordMutation(input: {
      storyId: StoryId;
      playthroughId: string;
      entityId: EntityId;
      field: string;
      oldValue: unknown;
      newValue: unknown;
    }): void {
      db.prepare(
        `INSERT INTO entity_mutations (id, story_id, playthrough_id, entity_id, field, old_value, new_value, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId('mut'),
        input.storyId,
        input.playthroughId,
        input.entityId,
        input.field,
        JSON.stringify(input.oldValue ?? null),
        JSON.stringify(input.newValue ?? null),
        nowIso(),
      );
    },

    listMutations(storyId: StoryId, playthroughId: string): EntityMutation[] {
      const rows = db
        .prepare(
          `SELECT * FROM entity_mutations
           WHERE story_id = ? AND playthrough_id = ? ORDER BY at, rowid`,
        )
        .all(storyId, playthroughId) as {
        id: string;
        story_id: string;
        playthrough_id: string;
        entity_id: string;
        field: string;
        old_value: string | null;
        new_value: string | null;
        at: string;
      }[];
      return rows.map((r) => ({
        id: r.id,
        storyId: r.story_id as StoryId,
        playthroughId: r.playthrough_id,
        entityId: r.entity_id as EntityId,
        field: r.field,
        oldValue: r.old_value === null ? null : (JSON.parse(r.old_value) as unknown),
        newValue: r.new_value === null ? null : (JSON.parse(r.new_value) as unknown),
        at: r.at,
      }));
    },

    /** Mutation history for one entity across all stories (world inspector). */
    listMutationsForEntity(entityId: EntityId): EntityMutation[] {
      const rows = db
        .prepare('SELECT * FROM entity_mutations WHERE entity_id = ? ORDER BY at, rowid')
        .all(entityId) as {
        id: string;
        story_id: string;
        playthrough_id: string;
        entity_id: string;
        field: string;
        old_value: string | null;
        new_value: string | null;
        at: string;
      }[];
      return rows.map((r) => ({
        id: r.id,
        storyId: r.story_id as StoryId,
        playthroughId: r.playthrough_id,
        entityId: r.entity_id as EntityId,
        field: r.field,
        oldValue: r.old_value === null ? null : (JSON.parse(r.old_value) as unknown),
        newValue: r.new_value === null ? null : (JSON.parse(r.new_value) as unknown),
        at: r.at,
      }));
    },

    // ── effect audit + idempotency (F638, F640) ─────────────────────────────

    recordEffectEvent(input: {
      storyId: StoryId;
      playthroughId: string;
      batchKey: string;
      type: EffectEvent['type'];
      payload: Record<string, unknown>;
    }): void {
      db.prepare(
        `INSERT INTO effect_events (id, story_id, playthrough_id, batch_key, type, payload, at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId('fx'),
        input.storyId,
        input.playthroughId,
        input.batchKey,
        input.type,
        JSON.stringify(input.payload),
        nowIso(),
      );
    },

    listEffectEvents(storyId: StoryId, playthroughId?: string): EffectEvent[] {
      const rows = (
        playthroughId === undefined
          ? db
              .prepare('SELECT * FROM effect_events WHERE story_id = ? ORDER BY at, rowid')
              .all(storyId)
          : db
              .prepare(
                'SELECT * FROM effect_events WHERE story_id = ? AND playthrough_id = ? ORDER BY at, rowid',
              )
              .all(storyId, playthroughId)
      ) as {
        id: string;
        story_id: string;
        playthrough_id: string;
        batch_key: string;
        type: string;
        payload: string;
        at: string;
      }[];
      return rows.map((r) => ({
        id: r.id,
        storyId: r.story_id as StoryId,
        playthroughId: r.playthrough_id,
        batchKey: r.batch_key,
        type: r.type as EffectEvent['type'],
        payload: JSON.parse(r.payload) as Record<string, unknown>,
        at: r.at,
      }));
    },

    getBatchResult(storyId: StoryId, batchKey: string): Record<string, unknown> | null {
      const row = db
        .prepare('SELECT result FROM effect_batches WHERE story_id = ? AND batch_key = ?')
        .get(storyId, batchKey) as { result: string } | undefined;
      return row ? (JSON.parse(row.result) as Record<string, unknown>) : null;
    },

    saveBatchResult(
      storyId: StoryId,
      playthroughId: string,
      batchKey: string,
      result: Record<string, unknown>,
    ): void {
      db.prepare(
        `INSERT INTO effect_batches (id, story_id, playthrough_id, batch_key, result, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(newId('fxb'), storyId, playthroughId, batchKey, JSON.stringify(result), nowIso());
    },
  };
}

export type CodexRepo = ReturnType<typeof codexRepo>;
