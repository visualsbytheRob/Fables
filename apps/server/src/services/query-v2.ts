/**
 * FQL v2 execution (Epic 20, F1961–F1965).
 *
 * Builds on `runFqlQuery`: fetches the matching notes (capped), enriches each
 * into a flat row joined with its notebook name, tag count and derived metrics
 * (the join surface, F1962), applies computed columns (F1963) and then runs the
 * group-and-aggregate pass (F1961). EXPLAIN (F1965) returns the static plan plus
 * the parameterized SQL the compiler would run — no rows fetched.
 */

import type { Db } from '../db/connection.js';
import {
  aggregate,
  compileFql,
  explainQuery,
  parseFql,
  substituteVariables,
  withComputed,
  type AggregateResult,
  type AggregateSpec,
  type ComputedColumn,
  type QueryPlan,
  type Row,
} from '../fql/index.js';
import { runFqlQuery } from './query.js';

/** Upper bound on rows pulled into an in-memory aggregation. */
export const AGGREGATE_ROW_LIMIT = 5000;

const wordCount = (body: string): number => {
  const trimmed = body.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
};

/** Flatten a note into an aggregation row joined with notebook + tag facts. */
function enrich(db: Db, notes: ReturnType<typeof runFqlQuery>['notes']): Row[] {
  const notebookNames = new Map(
    (db.prepare('SELECT id, name FROM notebooks').all() as { id: string; name: string }[]).map(
      (r) => [r.id, r.name],
    ),
  );
  const tagCounts = new Map(
    (
      db.prepare('SELECT note_id, COUNT(*) AS c FROM note_tags GROUP BY note_id').all() as {
        note_id: string;
        c: number;
      }[]
    ).map((r) => [r.note_id, r.c]),
  );
  return notes.map((n) => ({
    id: n.id,
    title: n.title,
    notebookId: n.notebookId,
    notebook: notebookNames.get(n.notebookId) ?? n.notebookId,
    pinned: n.pinned ? 1 : 0,
    words: wordCount(n.body),
    chars: n.body.length,
    tagCount: tagCounts.get(n.id) ?? 0,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    createdMonth: n.createdAt.slice(0, 7),
    updatedMonth: n.updatedAt.slice(0, 7),
  }));
}

export interface AggregateOptions {
  spec: AggregateSpec;
  computed?: ComputedColumn[] | undefined;
  vars?: Record<string, string> | undefined;
  now?: Date | undefined;
}

export interface AggregateQueryResult extends AggregateResult {
  warnings: string[];
  scanned: number;
}

/** Run a query and aggregate its results in memory (F1961–F1963). */
export function runAggregateQuery(db: Db, q: string, opts: AggregateOptions): AggregateQueryResult {
  const { query, missing } = substituteVariables(q, opts.vars ?? {});
  const { notes, warnings } = runFqlQuery(db, query, {
    fetch: AGGREGATE_ROW_LIMIT,
    cursor: null,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });
  const allWarnings = [...warnings];
  if (missing.length > 0) allWarnings.push(`unset variables: ${missing.join(', ')}`);

  const rows = withComputed(enrich(db, notes), opts.computed ?? []);
  const result = aggregate(rows, opts.spec);
  return { ...result, warnings: allWarnings, scanned: rows.length };
}

export interface ExplainResult extends QueryPlan {
  sql: string;
  params: unknown[];
  warnings: string[];
}

/** Static EXPLAIN: parse + plan + the parameterized WHERE the compiler emits. */
export function explainFqlQuery(q: string, now?: Date): ExplainResult {
  const { ast, warnings } = parseFql(q);
  const plan = explainQuery(ast);
  const { where, params } = compileFql(ast, now ?? new Date());
  return {
    ...plan,
    sql: `SELECT n.* FROM notes n WHERE n.trashed_at IS NULL AND (${where})`,
    params,
    warnings: [...plan.warnings, ...warnings],
  };
}
