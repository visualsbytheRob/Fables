/**
 * FQL aggregations + computed fields (Epic 20, F1961–F1963).
 *
 * Post-processing over a query's result rows: derive computed columns from
 * expressions, then group-and-aggregate (count/sum/avg/min/max). Pure and
 * deterministic — the SQL layer fetches rows, this shapes them. Joins across
 * types (F1962) are realised by enriching each row with its related fields
 * before calling these helpers; aggregation then works over the joined row.
 */

import { evaluateExpr, parseExpr, type ExprValue, type Row } from './expr.js';

export type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface Metric {
  fn: AggFn;
  /** Field to aggregate; ignored for `count`. */
  field?: string | undefined;
  /** Output column name. */
  as: string;
}

export interface ComputedColumn {
  as: string;
  expr: string;
}

export interface AggregateSpec {
  /** Field to group by; omitted means a single total group. */
  groupBy?: string | undefined;
  metrics: Metric[];
}

export interface GroupResult {
  key: string | null;
  rows: number;
  values: Record<string, number>;
}

export interface AggregateResult {
  groups: GroupResult[];
  total: { rows: number; values: Record<string, number> };
}

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** Add computed columns to each row (F1963). Bad expressions throw once, up front. */
export function withComputed(rows: Row[], columns: ComputedColumn[]): Row[] {
  if (columns.length === 0) return rows;
  const compiled = columns.map((c) => ({ as: c.as, node: parseExpr(c.expr) }));
  return rows.map((row) => {
    const next: Row = { ...row };
    for (const { as, node } of compiled) {
      next[as] = evaluateExpr(node, next) as ExprValue;
    }
    return next;
  });
}

function reduceMetric(values: number[], fn: AggFn, rowCount: number): number {
  switch (fn) {
    case 'count':
      return rowCount;
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return values.length === 0 ? 0 : Math.min(...values);
    case 'max':
      return values.length === 0 ? 0 : Math.max(...values);
  }
}

function computeValues(rows: Row[], metrics: Metric[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of metrics) {
    const values =
      m.fn === 'count' || m.field === undefined ? [] : rows.map((r) => num(r[m.field as string]));
    out[m.as] = reduceMetric(values, m.fn, rows.length);
  }
  return out;
}

/**
 * Group rows by `spec.groupBy` (or a single total group) and reduce each metric.
 * Groups are returned sorted by key for stable output; the grand total spans
 * every row regardless of grouping.
 */
export function aggregate(rows: Row[], spec: AggregateSpec): AggregateResult {
  const total = { rows: rows.length, values: computeValues(rows, spec.metrics) };
  if (spec.groupBy === undefined) {
    return { groups: [{ key: null, rows: rows.length, values: total.values }], total };
  }

  const buckets = new Map<string, Row[]>();
  const field = spec.groupBy;
  for (const row of rows) {
    const raw = row[field];
    const key = raw === undefined || raw === null ? '∅' : String(raw);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const groups: GroupResult[] = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, groupRows]) => ({
      key,
      rows: groupRows.length,
      values: computeValues(groupRows, spec.metrics),
    }));

  return { groups, total };
}
