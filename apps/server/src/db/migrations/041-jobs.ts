import type { Migration } from './index.js';

/**
 * Scheduled jobs + run log (Epic 20, F1921–F1929).
 *
 *   scheduled_jobs  a cron-scheduled job (backup/digest/reindex/rule) with its
 *                   next-run time, a concurrency guard, and run bookkeeping.
 *   job_runs        an outcome log (status + duration) per execution (F1923).
 */
export const migration041Jobs: Migration = {
  id: 41,
  name: 'jobs',
  sql: /* sql */ `
    CREATE TABLE scheduled_jobs (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL,
      cron       TEXT NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      last_run   TEXT,
      next_run   TEXT,
      run_count  INTEGER NOT NULL DEFAULT 0,
      running    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_scheduled_jobs_next ON scheduled_jobs (enabled, next_run);

    CREATE TABLE job_runs (
      id          TEXT PRIMARY KEY,
      job_id      TEXT NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
      status      TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      detail      TEXT NOT NULL DEFAULT '',
      ran_at      TEXT NOT NULL
    );
    CREATE INDEX idx_job_runs_job ON job_runs (job_id, ran_at);
  `,
};
