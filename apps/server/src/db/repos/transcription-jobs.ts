import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';

export type TranscriptionStatus = 'queued' | 'running' | 'done' | 'failed';
export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'large';

/** A single timestamped segment in a transcript (F784). */
export interface TranscriptSegment {
  start: number;   // seconds
  end: number;     // seconds
  text: string;
  speaker?: string; // populated by speaker heuristics (F788)
}

export interface TranscriptionResult {
  segments: TranscriptSegment[];
  language?: string | undefined;
  duration?: number | undefined;
}

export interface TranscriptionJob {
  id: string;
  attachmentId: string;
  noteId: string | null;
  status: TranscriptionStatus;
  modelSize: WhisperModelSize;
  retryCount: number;
  error: string | null;
  result: TranscriptionResult | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  attachment_id: string;
  note_id: string | null;
  status: string;
  model_size: string;
  retry_count: number;
  error: string | null;
  result: string | null;
  created_at: string;
  updated_at: string;
}

function toJob(row: Row): TranscriptionJob {
  return {
    id: row.id,
    attachmentId: row.attachment_id,
    noteId: row.note_id,
    status: row.status as TranscriptionStatus,
    modelSize: row.model_size as WhisperModelSize,
    retryCount: row.retry_count,
    error: row.error,
    result: row.result ? (JSON.parse(row.result) as TranscriptionResult) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function transcriptionJobsRepo(db: Db) {
  return {
    create(input: {
      attachmentId: string;
      modelSize?: WhisperModelSize;
    }): TranscriptionJob {
      const now = nowIso();
      const id = `txn_${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO transcription_jobs (id, attachment_id, model_size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id, input.attachmentId, input.modelSize ?? 'base', now, now);
      return this.get(id)!;
    },

    get(id: string): TranscriptionJob | null {
      const row = db
        .prepare('SELECT * FROM transcription_jobs WHERE id = ?')
        .get(id) as Row | undefined;
      return row ? toJob(row) : null;
    },

    list(opts: { limit?: number } = {}): TranscriptionJob[] {
      const rows = db
        .prepare('SELECT * FROM transcription_jobs ORDER BY created_at DESC LIMIT ?')
        .all(opts.limit ?? 50) as Row[];
      return rows.map(toJob);
    },

    setRunning(id: string): void {
      db.prepare(
        `UPDATE transcription_jobs SET status = 'running', updated_at = ? WHERE id = ?`,
      ).run(nowIso(), id);
    },

    setDone(id: string, noteId: string, result: TranscriptionResult): void {
      db.prepare(
        `UPDATE transcription_jobs SET status = 'done', note_id = ?, result = ?, updated_at = ? WHERE id = ?`,
      ).run(noteId, JSON.stringify(result), nowIso(), id);
    },

    setFailed(id: string, error: string): void {
      db.prepare(
        `UPDATE transcription_jobs
         SET status = 'failed', error = ?, retry_count = retry_count + 1, updated_at = ?
         WHERE id = ?`,
      ).run(error, nowIso(), id);
    },

    /** Re-queue a failed job for retry. */
    requeue(id: string): void {
      db.prepare(
        `UPDATE transcription_jobs SET status = 'queued', error = NULL, updated_at = ? WHERE id = ?`,
      ).run(nowIso(), id);
    },

    /** All queued jobs ordered oldest-first — picked up by the job runner. */
    pendingJobs(): TranscriptionJob[] {
      return (
        db
          .prepare(
            `SELECT * FROM transcription_jobs WHERE status = 'queued' ORDER BY created_at ASC`,
          )
          .all() as Row[]
      ).map(toJob);
    },
  };
}

export type TranscriptionJobsRepo = ReturnType<typeof transcriptionJobsRepo>;
