import { notFound, nowIso, type StoryId } from '@fables/core';
import type { StorySaveState } from '@fables/forge-vm';
import type { Db } from '../connection.js';

/**
 * Save slots + autosave ring buffer (F462/F463). `state` is the forge-vm
 * serialized save state, stored verbatim as JSON; `turn` and `scene` are
 * denormalised for cheap slot lists (groundwork for F467).
 */

export const AUTOSAVE_RING_SIZE = 10;

export type SaveKind = 'slot' | 'auto';

export interface StorySaveMeta {
  id: string;
  storyId: StoryId;
  kind: SaveKind;
  name: string;
  turn: number;
  /** Knot of the saved flow position — a human "where am I" hint. */
  scene: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorySave extends StorySaveMeta {
  state: StorySaveState;
}

interface Row {
  id: string;
  story_id: string;
  kind: string;
  name: string;
  state: string;
  turn: number;
  scene: string;
  created_at: string;
  updated_at: string;
}

function toMeta(row: Row): StorySaveMeta {
  return {
    id: row.id,
    storyId: row.story_id as StoryId,
    kind: row.kind as SaveKind,
    name: row.name,
    turn: row.turn,
    scene: row.scene,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSave(row: Row): StorySave {
  return { ...toMeta(row), state: JSON.parse(row.state) as StorySaveState };
}

/** "Where am I" hint from the topmost saved flow frame. */
export function sceneOf(state: StorySaveState): string {
  const frame = state.frames[state.frames.length - 1];
  if (frame === undefined) return '';
  return frame.container.split('#')[0] ?? frame.container;
}

export function storySavesRepo(db: Db) {
  return {
    /** Named slots overwrite on name collision — that is what slots are for. */
    upsertSlot(
      storyId: StoryId,
      name: string,
      state: StorySaveState,
    ): { save: StorySave; created: boolean } {
      const existing = db
        .prepare(`SELECT * FROM story_saves WHERE story_id = ? AND kind = 'slot' AND name = ?`)
        .get(storyId, name) as Row | undefined;
      const now = nowIso();
      if (existing) {
        db.prepare(
          'UPDATE story_saves SET state = ?, turn = ?, scene = ?, updated_at = ? WHERE id = ?',
        ).run(JSON.stringify(state), state.turn, sceneOf(state), now, existing.id);
        return { save: this.mustGet(storyId, existing.id), created: false };
      }
      const id = `sav_${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO story_saves (id, story_id, kind, name, state, turn, scene, created_at, updated_at)
         VALUES (?, ?, 'slot', ?, ?, ?, ?, ?, ?)`,
      ).run(id, storyId, name, JSON.stringify(state), state.turn, sceneOf(state), now, now);
      return { save: this.mustGet(storyId, id), created: true };
    },

    /**
     * Autosave ring buffer (F463): append, then trim to the newest
     * {@link AUTOSAVE_RING_SIZE} autosaves for the story.
     */
    pushAutosave(storyId: StoryId, state: StorySaveState): { save: StorySave; retained: number } {
      const id = `sav_${crypto.randomUUID()}`;
      const now = nowIso();
      db.prepare(
        `INSERT INTO story_saves (id, story_id, kind, name, state, turn, scene, created_at, updated_at)
         VALUES (?, ?, 'auto', ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        storyId,
        `autosave (turn ${state.turn})`,
        JSON.stringify(state),
        state.turn,
        sceneOf(state),
        now,
        now,
      );
      db.prepare(
        `DELETE FROM story_saves WHERE story_id = ? AND kind = 'auto' AND rowid NOT IN (
           SELECT rowid FROM story_saves WHERE story_id = ? AND kind = 'auto'
           ORDER BY rowid DESC LIMIT ?
         )`,
      ).run(storyId, storyId, AUTOSAVE_RING_SIZE);
      const retained = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM story_saves WHERE story_id = ? AND kind = 'auto'`)
          .get(storyId) as { n: number }
      ).n;
      return { save: this.mustGet(storyId, id), retained };
    },

    /** Newest first; metadata only — fetch one save for its full state. */
    list(storyId: StoryId, kind?: SaveKind): StorySaveMeta[] {
      const rows = (
        kind === undefined
          ? db
              .prepare('SELECT * FROM story_saves WHERE story_id = ? ORDER BY rowid DESC')
              .all(storyId)
          : db
              .prepare(
                'SELECT * FROM story_saves WHERE story_id = ? AND kind = ? ORDER BY rowid DESC',
              )
              .all(storyId, kind)
      ) as Row[];
      return rows.map(toMeta);
    },

    /** Like {@link list} but includes each save's full state (F467 slot meta). */
    listFull(storyId: StoryId, kind?: SaveKind): StorySave[] {
      const rows = (
        kind === undefined
          ? db
              .prepare('SELECT * FROM story_saves WHERE story_id = ? ORDER BY rowid DESC')
              .all(storyId)
          : db
              .prepare(
                'SELECT * FROM story_saves WHERE story_id = ? AND kind = ? ORDER BY rowid DESC',
              )
              .all(storyId, kind)
      ) as Row[];
      return rows.map(toSave);
    },

    get(storyId: StoryId, saveId: string): StorySave | null {
      const row = db
        .prepare('SELECT * FROM story_saves WHERE story_id = ? AND id = ?')
        .get(storyId, saveId) as Row | undefined;
      return row ? toSave(row) : null;
    },

    mustGet(storyId: StoryId, saveId: string): StorySave {
      const save = this.get(storyId, saveId);
      if (!save) throw notFound('Save', saveId);
      return save;
    },

    remove(storyId: StoryId, saveId: string): void {
      const changes = db
        .prepare('DELETE FROM story_saves WHERE story_id = ? AND id = ?')
        .run(storyId, saveId).changes;
      if (changes === 0) throw notFound('Save', saveId);
    },
  };
}

export type StorySavesRepo = ReturnType<typeof storySavesRepo>;
