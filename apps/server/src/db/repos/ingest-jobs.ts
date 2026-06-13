import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';

export type IngestSourceType = 'pdf' | 'epub' | 'html' | 'url' | 'audio';
export type IngestStatus = 'queued' | 'running' | 'done' | 'failed';

export interface IngestJobMetadata {
  sourceUrl?: string;
  siteName?: string;
  clippedAt?: string;
  favicon?: string;
  [key: string]: unknown;
}

export interface IngestJob {
  id: string;
  sourceType: IngestSourceType;
  sourceName: string;
  status: IngestStatus;
  total: number;
  progress: number;
  resultNoteId: string | null;
  attachmentId: string | null;
  error: string | null;
  metadata: IngestJobMetadata;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  source_type: string;
  source_name: string;
  status: string;
  total: number;
  progress: number;
  result_note_id: string | null;
  attachment_id: string | null;
  error: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function toJob(row: Row): IngestJob {
  return {
    id: row.id,
    sourceType: row.source_type as IngestSourceType,
    sourceName: row.source_name,
    status: row.status as IngestStatus,
    total: row.total,
    progress: row.progress,
    resultNoteId: row.result_note_id,
    attachmentId: row.attachment_id,
    error: row.error,
    metadata: JSON.parse(row.metadata) as IngestJobMetadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function ingestJobsRepo(db: Db) {
  return {
    create(input: {
      sourceType: IngestSourceType;
      sourceName: string;
      attachmentId?: string | null;
      metadata?: IngestJobMetadata;
    }): IngestJob {
      const now = nowIso();
      const id = `ingest_${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO ingest_jobs (id, source_type, source_name, status, attachment_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`,
      ).run(
        id,
        input.sourceType,
        input.sourceName,
        input.attachmentId ?? null,
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      );
      return this.get(id)!;
    },

    get(id: string): IngestJob | null {
      const row = db.prepare('SELECT * FROM ingest_jobs WHERE id = ?').get(id) as Row | undefined;
      return row ? toJob(row) : null;
    },

    list(opts: { limit?: number; cursor?: string | null } = {}): IngestJob[] {
      const limit = opts.limit ?? 50;
      const rows = (
        opts.cursor
          ? db
              .prepare('SELECT * FROM ingest_jobs WHERE id < ? ORDER BY created_at DESC LIMIT ?')
              .all(opts.cursor, limit)
          : db
              .prepare('SELECT * FROM ingest_jobs ORDER BY created_at DESC LIMIT ?')
              .all(limit)
      ) as Row[];
      return rows.map(toJob);
    },

    setRunning(id: string): void {
      db.prepare(
        `UPDATE ingest_jobs SET status = 'running', updated_at = ? WHERE id = ?`,
      ).run(nowIso(), id);
    },

    setProgress(id: string, progress: number, total: number): void {
      db.prepare(
        `UPDATE ingest_jobs SET progress = ?, total = ?, updated_at = ? WHERE id = ?`,
      ).run(progress, total, nowIso(), id);
    },

    setDone(id: string, resultNoteId: string): void {
      db.prepare(
        `UPDATE ingest_jobs SET status = 'done', result_note_id = ?, updated_at = ? WHERE id = ?`,
      ).run(resultNoteId, nowIso(), id);
    },

    setFailed(id: string, error: string): void {
      db.prepare(
        `UPDATE ingest_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
      ).run(error, nowIso(), id);
    },

    /** Find existing completed job by source URL for duplicate detection (F777). */
    findBySourceUrl(url: string): IngestJob | null {
      const row = db
        .prepare(
          `SELECT * FROM ingest_jobs WHERE status = 'done'
           AND json_extract(metadata, '$.sourceUrl') = ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(url) as Row | undefined;
      return row ? toJob(row) : null;
    },
  };
}

export type IngestJobsRepo = ReturnType<typeof ingestJobsRepo>;
