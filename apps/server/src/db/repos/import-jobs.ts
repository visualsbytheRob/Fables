import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';

/** Per-file import failure — recorded, never fatal to the run (F297). */
export interface ImportFileError {
  file: string;
  message: string;
}

export interface ImportJob {
  id: string;
  path: string;
  status: 'running' | 'done' | 'failed';
  total: number;
  processed: number;
  imported: number;
  merged: number;
  renamed: number;
  skipped: number;
  attachments: number;
  errors: ImportFileError[];
  createdAt: string;
  updatedAt: string;
}

export type ImportJobCounters = Pick<
  ImportJob,
  'processed' | 'imported' | 'merged' | 'renamed' | 'skipped' | 'attachments'
>;

interface Row {
  id: string;
  path: string;
  status: string;
  total: number;
  processed: number;
  imported: number;
  merged: number;
  renamed: number;
  skipped: number;
  attachments: number;
  errors: string;
  created_at: string;
  updated_at: string;
}

const toJob = (row: Row): ImportJob => ({
  id: row.id,
  path: row.path,
  status: row.status as ImportJob['status'],
  total: row.total,
  processed: row.processed,
  imported: row.imported,
  merged: row.merged,
  renamed: row.renamed,
  skipped: row.skipped,
  attachments: row.attachments,
  errors: JSON.parse(row.errors) as ImportFileError[],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function importJobsRepo(db: Db) {
  return {
    create(path: string, total: number): ImportJob {
      const now = nowIso();
      const id = `job_${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO import_jobs (id, path, status, total, created_at, updated_at)
         VALUES (?, ?, 'running', ?, ?, ?)`,
      ).run(id, path, total, now, now);
      return this.get(id)!;
    },

    get(id: string): ImportJob | null {
      const row = db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(id) as Row | undefined;
      return row ? toJob(row) : null;
    },

    /** Batch progress update — counters plus the accumulated error list. */
    progress(id: string, counters: ImportJobCounters, errors: ImportFileError[]): void {
      db.prepare(
        `UPDATE import_jobs SET processed = ?, imported = ?, merged = ?, renamed = ?,
           skipped = ?, attachments = ?, errors = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        counters.processed,
        counters.imported,
        counters.merged,
        counters.renamed,
        counters.skipped,
        counters.attachments,
        JSON.stringify(errors),
        nowIso(),
        id,
      );
    },

    finish(id: string, status: 'done' | 'failed'): void {
      db.prepare('UPDATE import_jobs SET status = ?, updated_at = ? WHERE id = ?').run(
        status,
        nowIso(),
        id,
      );
    },
  };
}

export type ImportJobsRepo = ReturnType<typeof importJobsRepo>;
