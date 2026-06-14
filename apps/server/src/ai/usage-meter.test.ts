/**
 * AI usage-meter tests (F1367) — per-feature, per-backend, monthly accumulation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { monthBucket, usageMeter } from './usage-meter.js';

let db: Db;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
});

afterEach(() => {
  db.close();
});

describe('usage meter (F1367)', () => {
  it('accumulates tokens and calls per (month, feature, backend)', () => {
    const meter = usageMeter(db);
    const when = new Date('2026-06-10T00:00:00Z');
    meter.record({ feature: 'prose', backend: 'claude', inputTokens: 100, outputTokens: 50 }, when);
    meter.record({ feature: 'prose', backend: 'claude', inputTokens: 20, outputTokens: 10 }, when);
    meter.record({ feature: 'tags', backend: 'ollama', inputTokens: 5, outputTokens: 1 }, when);

    const rows = meter.forMonth('2026-06');
    const prose = rows.find((r) => r.feature === 'prose')!;
    expect(prose.inputTokens).toBe(120);
    expect(prose.outputTokens).toBe(60);
    expect(prose.calls).toBe(2);
    // Highest token use sorts first.
    expect(rows[0]!.feature).toBe('prose');
  });

  it('totals the whole month across features and backends', () => {
    const meter = usageMeter(db);
    const when = new Date('2026-06-10T00:00:00Z');
    meter.record({ feature: 'prose', backend: 'claude', inputTokens: 100, outputTokens: 50 }, when);
    meter.record({ feature: 'tags', backend: 'ollama', inputTokens: 5, outputTokens: 1 }, when);
    const total = meter.monthlyTotal('2026-06');
    expect(total.inputTokens).toBe(105);
    expect(total.outputTokens).toBe(51);
    expect(total.calls).toBe(2);
  });

  it('buckets by calendar month (UTC)', () => {
    expect(monthBucket(new Date('2026-01-31T23:00:00Z'))).toBe('2026-01');
    expect(monthBucket(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12');
  });

  it('separates different months', () => {
    const meter = usageMeter(db);
    meter.record(
      { feature: 'prose', backend: 'claude', inputTokens: 10, outputTokens: 5 },
      new Date('2026-05-01T00:00:00Z'),
    );
    meter.record(
      { feature: 'prose', backend: 'claude', inputTokens: 10, outputTokens: 5 },
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(meter.monthlyTotal('2026-05').calls).toBe(1);
    expect(meter.monthlyTotal('2026-06').calls).toBe(1);
  });
});
