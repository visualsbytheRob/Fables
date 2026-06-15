/**
 * Recording takes repository (Epic 17, F1651–F1659).
 *
 * Content-addressed human-narration takes (migration 033). Each take is stored
 * by a sha256 of its audio (F1659) so re-uploading identical bytes for the same
 * line dedupes. The first take recorded for a line becomes active; `setActive`
 * picks the best take (F1653); removing the active take promotes the most recent
 * remaining one so a line is never left silently un-chosen.
 */

import { createHash } from 'node:crypto';
import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';

export type TakeFormat = 'opus' | 'wav' | 'webm' | 'mp4';

export interface RecordingTake {
  id: string;
  storyId: string;
  lineKey: string;
  contentHash: string;
  format: TakeFormat;
  durationMs: number | null;
  bytes: number;
  active: boolean;
  createdAt: string;
}

interface TakeRow {
  id: string;
  story_id: string;
  line_key: string;
  content_hash: string;
  format: string;
  duration_ms: number | null;
  bytes: number;
  active: number;
  created_at: string;
}

const toTake = (r: TakeRow): RecordingTake => ({
  id: r.id,
  storyId: r.story_id,
  lineKey: r.line_key,
  contentHash: r.content_hash,
  format: r.format as TakeFormat,
  durationMs: r.duration_ms,
  bytes: r.bytes,
  active: r.active === 1,
  createdAt: r.created_at,
});

const newTakeId = (): string => `take_${crypto.randomUUID()}`;

export interface AddTakeInput {
  storyId: string;
  lineKey: string;
  audio: Uint8Array;
  format: TakeFormat;
  durationMs?: number | undefined;
}

export function recordingTakesRepo(db: Db) {
  return {
    /** Add a take (deduping identical bytes for the line). First take ⇒ active. */
    add(input: AddTakeInput): RecordingTake {
      const contentHash = createHash('sha256').update(input.audio).digest('hex');
      const existing = db
        .prepare(
          'SELECT * FROM recording_takes WHERE story_id = ? AND line_key = ? AND content_hash = ?',
        )
        .get(input.storyId, input.lineKey, contentHash) as TakeRow | undefined;
      if (existing) return toTake(existing);

      const hasActive = db
        .prepare('SELECT 1 FROM recording_takes WHERE story_id = ? AND line_key = ? AND active = 1')
        .get(input.storyId, input.lineKey);

      const take: RecordingTake = {
        id: newTakeId(),
        storyId: input.storyId,
        lineKey: input.lineKey,
        contentHash,
        format: input.format,
        durationMs: input.durationMs ?? null,
        bytes: input.audio.byteLength,
        active: !hasActive,
        createdAt: nowIso(),
      };
      db.prepare(
        `INSERT INTO recording_takes
           (id, story_id, line_key, content_hash, format, duration_ms, bytes, audio, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        take.id,
        take.storyId,
        take.lineKey,
        take.contentHash,
        take.format,
        take.durationMs,
        take.bytes,
        Buffer.from(input.audio),
        take.active ? 1 : 0,
        take.createdAt,
      );
      return take;
    },

    list(storyId: string, lineKey: string): RecordingTake[] {
      return (
        db
          .prepare(
            'SELECT * FROM recording_takes WHERE story_id = ? AND line_key = ? ORDER BY created_at',
          )
          .all(storyId, lineKey) as TakeRow[]
      ).map(toTake);
    },

    active(storyId: string, lineKey: string): RecordingTake | null {
      const row = db
        .prepare('SELECT * FROM recording_takes WHERE story_id = ? AND line_key = ? AND active = 1')
        .get(storyId, lineKey) as TakeRow | undefined;
      return row ? toTake(row) : null;
    },

    audio(takeId: string): Uint8Array | null {
      const row = db.prepare('SELECT audio FROM recording_takes WHERE id = ?').get(takeId) as
        | { audio: Buffer }
        | undefined;
      return row ? new Uint8Array(row.audio) : null;
    },

    /** Pick the active take for its line (F1653). Returns false if not found. */
    setActive(takeId: string): boolean {
      const row = db
        .prepare('SELECT story_id, line_key FROM recording_takes WHERE id = ?')
        .get(takeId) as { story_id: string; line_key: string } | undefined;
      if (!row) return false;
      const tx = db.transaction(() => {
        db.prepare('UPDATE recording_takes SET active = 0 WHERE story_id = ? AND line_key = ?').run(
          row.story_id,
          row.line_key,
        );
        db.prepare('UPDATE recording_takes SET active = 1 WHERE id = ?').run(takeId);
      });
      tx();
      return true;
    },

    /** Remove a take; promote the newest remaining take if the active one went. */
    remove(takeId: string): boolean {
      const row = db
        .prepare('SELECT story_id, line_key, active FROM recording_takes WHERE id = ?')
        .get(takeId) as { story_id: string; line_key: string; active: number } | undefined;
      if (!row) return false;
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM recording_takes WHERE id = ?').run(takeId);
        if (row.active === 1) {
          const next = db
            .prepare(
              'SELECT id FROM recording_takes WHERE story_id = ? AND line_key = ? ORDER BY created_at DESC LIMIT 1',
            )
            .get(row.story_id, row.line_key) as { id: string } | undefined;
          if (next) db.prepare('UPDATE recording_takes SET active = 1 WHERE id = ?').run(next.id);
        }
      });
      tx();
      return true;
    },

    /** Line keys with an active human take — feeds the recording plan (F1656). */
    recordedLineKeys(storyId: string): Set<string> {
      const rows = db
        .prepare('SELECT DISTINCT line_key FROM recording_takes WHERE story_id = ? AND active = 1')
        .all(storyId) as { line_key: string }[];
      return new Set(rows.map((r) => r.line_key));
    },
  };
}

export type RecordingTakesRepo = ReturnType<typeof recordingTakesRepo>;
