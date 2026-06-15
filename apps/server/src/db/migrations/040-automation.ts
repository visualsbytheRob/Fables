import type { Migration } from './index.js';

/**
 * Automation rules + run history (Epic 20, F1911/F1915).
 *
 *   automation_rules  trigger + conditions + actions (JSON), an enabled flag, and
 *                     run bookkeeping (count, last run, disabled-on-error reason).
 *   rule_runs         a log of each rule firing with the action plan + a diff of
 *                     what changed, for the run-history view (F1915).
 */
export const migration040Automation: Migration = {
  id: 40,
  name: 'automation',
  sql: /* sql */ `
    CREATE TABLE automation_rules (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      trigger     TEXT NOT NULL,
      conditions  TEXT NOT NULL DEFAULT '[]',
      actions     TEXT NOT NULL DEFAULT '[]',
      enabled     INTEGER NOT NULL DEFAULT 1,
      run_count   INTEGER NOT NULL DEFAULT 0,
      last_run    TEXT,
      error       TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE rule_runs (
      id         TEXT PRIMARY KEY,
      rule_id    TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
      note_id    TEXT NOT NULL DEFAULT '',
      fired      INTEGER NOT NULL DEFAULT 0,
      plan       TEXT NOT NULL DEFAULT '[]',
      diff       TEXT NOT NULL DEFAULT '{}',
      dry_run    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_rule_runs_rule ON rule_runs (rule_id, created_at);
  `,
};
