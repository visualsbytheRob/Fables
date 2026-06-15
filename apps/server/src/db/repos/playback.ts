/**
 * Playback state repository (Epic 17, F1673/F1674/F1675/F1678).
 *
 * Three small stores backing the audio player (migration 034):
 *   - position: per-item resume position + completion + an accumulated
 *     listened-ms counter that feeds listening stats (F1673/F1678).
 *   - queue: an ordered chain of items to play next (F1674).
 *   - pins: items marked for offline caching (F1675).
 *
 * Items are addressed by (type, id) where type is 'story' or 'note'.
 */

import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';

export type PlayItemType = 'story' | 'note';

/** A position at/after this fraction of the duration counts as completed. */
const COMPLETE_AT = 0.98;

export interface PlaybackPosition {
  itemType: PlayItemType;
  itemId: string;
  positionMs: number;
  durationMs: number;
  listenedMs: number;
  completed: boolean;
  updatedAt: string;
}

interface PositionRow {
  item_type: string;
  item_id: string;
  position_ms: number;
  duration_ms: number;
  listened_ms: number;
  completed: number;
  updated_at: string;
}

const toPosition = (r: PositionRow): PlaybackPosition => ({
  itemType: r.item_type as PlayItemType,
  itemId: r.item_id,
  positionMs: r.position_ms,
  durationMs: r.duration_ms,
  listenedMs: r.listened_ms,
  completed: r.completed === 1,
  updatedAt: r.updated_at,
});

export interface QueueEntry {
  id: string;
  ord: number;
  itemType: PlayItemType;
  itemId: string;
  title: string;
  addedAt: string;
}

interface QueueRow {
  id: string;
  ord: number;
  item_type: string;
  item_id: string;
  title: string;
  added_at: string;
}

const toQueueEntry = (r: QueueRow): QueueEntry => ({
  id: r.id,
  ord: r.ord,
  itemType: r.item_type as PlayItemType,
  itemId: r.item_id,
  title: r.title,
  addedAt: r.added_at,
});

export interface PinEntry {
  itemType: PlayItemType;
  itemId: string;
  title: string;
  pinnedAt: string;
}

export interface ListeningStats {
  totalListenedMs: number;
  completed: number;
  inProgress: number;
  items: number;
}

export function playbackRepo(db: Db) {
  const position = {
    /** Save a resume position; accumulates `listenedDeltaMs` for stats (F1678). */
    save(
      itemType: PlayItemType,
      itemId: string,
      positionMs: number,
      durationMs: number,
      listenedDeltaMs = 0,
    ): PlaybackPosition {
      const completed = durationMs > 0 && positionMs >= durationMs * COMPLETE_AT ? 1 : 0;
      const now = nowIso();
      db.prepare(
        `INSERT INTO playback_state
           (item_type, item_id, position_ms, duration_ms, listened_ms, completed, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_type, item_id) DO UPDATE SET
           position_ms = excluded.position_ms,
           duration_ms = excluded.duration_ms,
           listened_ms = playback_state.listened_ms + ?,
           completed   = MAX(playback_state.completed, excluded.completed),
           updated_at  = excluded.updated_at`,
      ).run(
        itemType,
        itemId,
        positionMs,
        durationMs,
        Math.max(0, listenedDeltaMs),
        completed,
        now,
        Math.max(0, listenedDeltaMs),
      );
      return this.get(itemType, itemId)!;
    },

    get(itemType: PlayItemType, itemId: string): PlaybackPosition | null {
      const row = db
        .prepare('SELECT * FROM playback_state WHERE item_type = ? AND item_id = ?')
        .get(itemType, itemId) as PositionRow | undefined;
      return row ? toPosition(row) : null;
    },

    clear(itemType: PlayItemType, itemId: string): boolean {
      return (
        db
          .prepare('DELETE FROM playback_state WHERE item_type = ? AND item_id = ?')
          .run(itemType, itemId).changes > 0
      );
    },

    stats(): ListeningStats {
      const row = db
        .prepare(
          `SELECT
             COALESCE(SUM(listened_ms), 0) AS total,
             COALESCE(SUM(completed), 0) AS done,
             COUNT(*) AS items,
             COALESCE(SUM(CASE WHEN completed = 0 AND position_ms > 0 THEN 1 ELSE 0 END), 0) AS inprog
           FROM playback_state`,
        )
        .get() as { total: number; done: number; items: number; inprog: number };
      return {
        totalListenedMs: row.total,
        completed: row.done,
        inProgress: row.inprog,
        items: row.items,
      };
    },
  };

  const queue = {
    list(): QueueEntry[] {
      return (db.prepare('SELECT * FROM listening_queue ORDER BY ord').all() as QueueRow[]).map(
        toQueueEntry,
      );
    },

    add(itemType: PlayItemType, itemId: string, title: string): QueueEntry {
      const next = db
        .prepare('SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM listening_queue')
        .get() as {
        n: number;
      };
      const entry: QueueEntry = {
        id: `q_${crypto.randomUUID()}`,
        ord: next.n,
        itemType,
        itemId,
        title,
        addedAt: nowIso(),
      };
      db.prepare(
        'INSERT INTO listening_queue (id, ord, item_type, item_id, title, added_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(entry.id, entry.ord, entry.itemType, entry.itemId, entry.title, entry.addedAt);
      return entry;
    },

    remove(id: string): boolean {
      return db.prepare('DELETE FROM listening_queue WHERE id = ?').run(id).changes > 0;
    },

    /** Re-order the queue to match the given id sequence; unknown ids ignored. */
    reorder(ids: string[]): QueueEntry[] {
      const tx = db.transaction(() => {
        ids.forEach((id, i) => {
          db.prepare('UPDATE listening_queue SET ord = ? WHERE id = ?').run(i, id);
        });
      });
      tx();
      return this.list();
    },

    clear(): void {
      db.prepare('DELETE FROM listening_queue').run();
    },
  };

  const pins = {
    list(): PinEntry[] {
      return (
        db.prepare('SELECT * FROM audio_pins ORDER BY pinned_at DESC').all() as {
          item_type: string;
          item_id: string;
          title: string;
          pinned_at: string;
        }[]
      ).map((r) => ({
        itemType: r.item_type as PlayItemType,
        itemId: r.item_id,
        title: r.title,
        pinnedAt: r.pinned_at,
      }));
    },

    set(itemType: PlayItemType, itemId: string, pinned: boolean, title = ''): boolean {
      if (pinned) {
        db.prepare(
          `INSERT INTO audio_pins (item_type, item_id, title, pinned_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(item_type, item_id) DO UPDATE SET title = excluded.title`,
        ).run(itemType, itemId, title, nowIso());
        return true;
      }
      db.prepare('DELETE FROM audio_pins WHERE item_type = ? AND item_id = ?').run(
        itemType,
        itemId,
      );
      return false;
    },

    isPinned(itemType: PlayItemType, itemId: string): boolean {
      return (
        db
          .prepare('SELECT 1 FROM audio_pins WHERE item_type = ? AND item_id = ?')
          .get(itemType, itemId) !== undefined
      );
    },
  };

  return { position, queue, pins };
}

export type PlaybackRepo = ReturnType<typeof playbackRepo>;
