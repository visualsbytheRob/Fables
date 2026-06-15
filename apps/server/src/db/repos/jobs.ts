/**
 * Scheduled jobs repository (Epic 20, F1921–F1929).
 *
 * Cron-scheduled jobs (migration 041) using the pure cron core for next-run +
 * missed-run computation. The repo owns scheduling state — due computation,
 * concurrency guard, run log, missed-job catch-up; a boot-time scheduler ticks
 * `due()` and dispatches the job's handler, recording the outcome here.
 */

import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';
import { nextRun, missedRuns, isValidCron } from '../../jobs/cron.js';

export type JobType = 'backup' | 'digest' | 'reindex' | 'rule';
export type JobStatus = 'ok' | 'error' | 'skipped';

export interface ScheduledJob {
  id: string;
  name: string;
  type: JobType;
  cron: string;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
  runCount: number;
  running: boolean;
  createdAt: string;
  updatedAt: string;
}

interface JobRow {
  id: string;
  name: string;
  type: string;
  cron: string;
  enabled: number;
  last_run: string | null;
  next_run: string | null;
  run_count: number;
  running: number;
  created_at: string;
  updated_at: string;
}

const toJob = (r: JobRow): ScheduledJob => ({
  id: r.id,
  name: r.name,
  type: r.type as JobType,
  cron: r.cron,
  enabled: r.enabled === 1,
  lastRun: r.last_run,
  nextRun: r.next_run,
  runCount: r.run_count,
  running: r.running === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface JobInput {
  name: string;
  type: JobType;
  cron: string;
  enabled?: boolean;
}

export function jobsRepo(db: Db) {
  return {
    create(input: JobInput, now = nowIso()): ScheduledJob {
      if (!isValidCron(input.cron)) {
        throw new Error(`invalid cron expression: ${input.cron}`);
      }
      const next = nextRun(input.cron, new Date(now)).toISOString();
      const job: ScheduledJob = {
        id: `job_${crypto.randomUUID()}`,
        name: input.name,
        type: input.type,
        cron: input.cron,
        enabled: input.enabled ?? true,
        lastRun: null,
        nextRun: next,
        runCount: 0,
        running: false,
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO scheduled_jobs (id, name, type, cron, enabled, last_run, next_run, run_count, running, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 0, ?, ?)`,
      ).run(job.id, job.name, job.type, job.cron, job.enabled ? 1 : 0, next, now, now);
      return job;
    },

    get(id: string): ScheduledJob | null {
      const row = db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id) as
        | JobRow
        | undefined;
      return row ? toJob(row) : null;
    },

    list(): ScheduledJob[] {
      return (db.prepare('SELECT * FROM scheduled_jobs ORDER BY name').all() as JobRow[]).map(
        toJob,
      );
    },

    update(
      id: string,
      patch: {
        name?: string | undefined;
        cron?: string | undefined;
        enabled?: boolean | undefined;
      },
      now = nowIso(),
    ): ScheduledJob | null {
      const cur = this.get(id);
      if (!cur) return null;
      if (patch.cron !== undefined && !isValidCron(patch.cron)) {
        throw new Error(`invalid cron expression: ${patch.cron}`);
      }
      const cron = patch.cron ?? cur.cron;
      const next = nextRun(cron, new Date(now)).toISOString();
      db.prepare(
        'UPDATE scheduled_jobs SET name = ?, cron = ?, enabled = ?, next_run = ?, updated_at = ? WHERE id = ?',
      ).run(patch.name ?? cur.name, cron, (patch.enabled ?? cur.enabled) ? 1 : 0, next, now, id);
      return this.get(id);
    },

    remove(id: string): boolean {
      return db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id).changes > 0;
    },

    /** Enabled, not-running jobs whose next_run is due (F1928 concurrency-aware). */
    due(now = nowIso()): ScheduledJob[] {
      return (
        db
          .prepare(
            'SELECT * FROM scheduled_jobs WHERE enabled = 1 AND running = 0 AND next_run IS NOT NULL AND next_run <= ? ORDER BY next_run',
          )
          .all(now) as JobRow[]
      ).map(toJob);
    },

    /** Claim a job for execution (concurrency guard, F1925). Returns false if taken. */
    claim(id: string): boolean {
      return (
        db.prepare('UPDATE scheduled_jobs SET running = 1 WHERE id = ? AND running = 0').run(id)
          .changes > 0
      );
    },

    /** Record an execution outcome, advance next_run, release the guard (F1923). */
    recordRun(
      id: string,
      status: JobStatus,
      durationMs: number,
      detail = '',
      now = nowIso(),
    ): void {
      const job = this.get(id);
      if (!job) return;
      const next = nextRun(job.cron, new Date(now)).toISOString();
      const tx = db.transaction(() => {
        db.prepare(
          'INSERT INTO job_runs (id, job_id, status, duration_ms, detail, ran_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(`jrun_${crypto.randomUUID()}`, id, status, durationMs, detail, now);
        db.prepare(
          'UPDATE scheduled_jobs SET run_count = run_count + 1, last_run = ?, next_run = ?, running = 0 WHERE id = ?',
        ).run(now, next, id);
      });
      tx();
    },

    /** Whether a job missed runs while the machine was asleep (F1924). */
    missed(id: string, now = nowIso()): number {
      const job = this.get(id);
      if (!job || job.lastRun === null) return 0;
      return missedRuns(job.cron, new Date(job.lastRun), new Date(now)).length;
    },

    runLog(
      id: string,
      limit = 100,
    ): {
      id: string;
      status: JobStatus;
      durationMs: number;
      detail: string;
      ranAt: string;
    }[] {
      return (
        db
          .prepare('SELECT * FROM job_runs WHERE job_id = ? ORDER BY ran_at DESC LIMIT ?')
          .all(id, limit) as {
          id: string;
          status: string;
          duration_ms: number;
          detail: string;
          ran_at: string;
        }[]
      ).map((r) => ({
        id: r.id,
        status: r.status as JobStatus,
        durationMs: r.duration_ms,
        detail: r.detail,
        ranAt: r.ran_at,
      }));
    },
  };
}

export type JobsRepo = ReturnType<typeof jobsRepo>;
