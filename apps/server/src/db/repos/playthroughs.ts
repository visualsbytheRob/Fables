import { conflict, notFound, nowIso, type StoryId } from '@fables/core';
import type { Db } from '../connection.js';

/**
 * Playthrough rows (F644/F651/F686): binding mode, sandbox flag, the frozen
 * knowledge-state snapshot, and started/finished timestamps. Playthrough ids
 * are client-chosen strings, unique per story — codex/effects tables already
 * use the same convention.
 */

export type BindingMode = 'live' | 'snapshot';

export interface Playthrough {
  storyId: StoryId;
  id: string;
  mode: BindingMode;
  sandbox: boolean;
  /** Knowledge-state JSON frozen at start when mode is 'snapshot' (F644). */
  snapshot: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string | null;
}

interface Row {
  story_id: string;
  id: string;
  mode: string;
  sandbox: number;
  snapshot: string | null;
  started_at: string;
  finished_at: string | null;
}

function toPlaythrough(row: Row): Playthrough {
  return {
    storyId: row.story_id as StoryId,
    id: row.id,
    mode: row.mode as BindingMode,
    sandbox: row.sandbox === 1,
    snapshot: row.snapshot === null ? null : (JSON.parse(row.snapshot) as Record<string, unknown>),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function playthroughsRepo(db: Db) {
  return {
    create(input: {
      storyId: StoryId;
      id: string;
      mode: BindingMode;
      sandbox: boolean;
      snapshot: Record<string, unknown> | null;
    }): Playthrough {
      if (this.get(input.storyId, input.id)) {
        throw conflict(`playthrough "${input.id}" already exists for this story`, {
          playthroughId: input.id,
        });
      }
      db.prepare(
        `INSERT INTO playthroughs (story_id, id, mode, sandbox, snapshot, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      ).run(
        input.storyId,
        input.id,
        input.mode,
        input.sandbox ? 1 : 0,
        input.snapshot === null ? null : JSON.stringify(input.snapshot),
        nowIso(),
      );
      return this.mustGet(input.storyId, input.id);
    },

    get(storyId: StoryId, id: string): Playthrough | null {
      const row = db
        .prepare('SELECT * FROM playthroughs WHERE story_id = ? AND id = ?')
        .get(storyId, id) as Row | undefined;
      return row ? toPlaythrough(row) : null;
    },

    mustGet(storyId: StoryId, id: string): Playthrough {
      const playthrough = this.get(storyId, id);
      if (!playthrough) throw notFound('Playthrough', id);
      return playthrough;
    },

    list(storyId: StoryId): Playthrough[] {
      const rows = db
        .prepare('SELECT * FROM playthroughs WHERE story_id = ? ORDER BY started_at, id')
        .all(storyId) as Row[];
      return rows.map(toPlaythrough);
    },

    /** Every playthrough row across stories — timeline feed (F651). */
    listAll(): Playthrough[] {
      const rows = db.prepare('SELECT * FROM playthroughs ORDER BY started_at, id').all() as Row[];
      return rows.map(toPlaythrough);
    },

    /** Idempotent: finishing twice keeps the first finished_at. */
    finish(storyId: StoryId, id: string): Playthrough {
      this.mustGet(storyId, id);
      db.prepare(
        'UPDATE playthroughs SET finished_at = ? WHERE story_id = ? AND id = ? AND finished_at IS NULL',
      ).run(nowIso(), storyId, id);
      return this.mustGet(storyId, id);
    },
  };
}

export type PlaythroughsRepo = ReturnType<typeof playthroughsRepo>;
