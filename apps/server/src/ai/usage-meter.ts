/**
 * Local AI usage meter (F1367).
 *
 * Tracks token usage per feature, per backend, bucketed by calendar month — all
 * on-device, never synced. Cloud calls cost money and leave the machine, so a
 * visible local meter keeps the user in control. Counts accumulate via upsert so
 * recording is a single cheap statement on the hot path.
 */

import type { Db } from '../db/connection.js';

export interface UsageRecord {
  feature: string;
  backend: string;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageRow {
  month: string;
  feature: string;
  backend: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface MonthlyTotal {
  month: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

/** 'YYYY-MM' bucket for a date (UTC — stable regardless of host timezone). */
export function monthBucket(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function usageMeter(db: Db) {
  return {
    /** Record a single AI call's token usage (F1367). */
    record(rec: UsageRecord, when = new Date()): void {
      const month = monthBucket(when);
      db.prepare(
        `INSERT INTO ai_usage (month, feature, backend, input_tokens, output_tokens, calls, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(month, feature, backend) DO UPDATE SET
           input_tokens = input_tokens + excluded.input_tokens,
           output_tokens = output_tokens + excluded.output_tokens,
           calls = calls + 1,
           updated_at = excluded.updated_at`,
      ).run(
        month,
        rec.feature,
        rec.backend,
        Math.max(0, Math.round(rec.inputTokens)),
        Math.max(0, Math.round(rec.outputTokens)),
        when.toISOString(),
      );
    },

    /** All usage rows for a month, highest token use first (F1367). */
    forMonth(month = monthBucket()): UsageRow[] {
      const rows = db
        .prepare(
          `SELECT month, feature, backend, input_tokens, output_tokens, calls
           FROM ai_usage WHERE month = ?
           ORDER BY (input_tokens + output_tokens) DESC, feature ASC`,
        )
        .all(month) as {
        month: string;
        feature: string;
        backend: string;
        input_tokens: number;
        output_tokens: number;
        calls: number;
      }[];
      return rows.map((r) => ({
        month: r.month,
        feature: r.feature,
        backend: r.backend,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        calls: r.calls,
      }));
    },

    /** Whole-month meter total across features/backends (F1367). */
    monthlyTotal(month = monthBucket()): MonthlyTotal {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
                  COALESCE(SUM(output_tokens), 0) AS output_tokens,
                  COALESCE(SUM(calls), 0) AS calls
           FROM ai_usage WHERE month = ?`,
        )
        .get(month) as { input_tokens: number; output_tokens: number; calls: number };
      return {
        month,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        calls: row.calls,
      };
    },
  };
}

export type UsageMeter = ReturnType<typeof usageMeter>;
