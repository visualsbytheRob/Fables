/**
 * Learning insights repository (Epic 18, F1751–F1759).
 *
 * Read-only analytics computed from the review log + cards: true retention,
 * a review heatmap, a workload forecast, difficulty distribution, leech
 * detection, knowledge coverage, and review streaks. All local; nothing leaves
 * the device.
 */

import type { Db } from '../connection.js';

const MS_PER_DAY = 86_400_000;
const dayKey = (iso: string): string => iso.slice(0, 10);

export function learningInsightsRepo(db: Db) {
  return {
    /**
     * True retention (F1751): of reviews on cards that were already in review/
     * relearning (i.e. genuine recall tests), the fraction answered without a
     * lapse (rating != Again). Optionally restricted to reviews since an ISO date.
     */
    trueRetention(since?: string): { reviews: number; recalled: number; retention: number } {
      const where = since ? 'AND reviewed_at >= ?' : '';
      const args = since ? [since] : [];
      const row = db
        .prepare(
          `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN rating != 1 THEN 1 ELSE 0 END), 0) AS ok
           FROM review_log
           WHERE state_before IN ('review', 'relearning') ${where}`,
        )
        .get(...args) as { total: number; ok: number };
      return {
        reviews: row.total,
        recalled: row.ok,
        retention: row.total > 0 ? row.ok / row.total : 0,
      };
    },

    /** Reviews per day for a heatmap calendar (F1752). */
    heatmap(since?: string): { date: string; count: number }[] {
      const where = since ? 'WHERE reviewed_at >= ?' : '';
      const args = since ? [since] : [];
      return db
        .prepare(
          `SELECT substr(reviewed_at, 1, 10) AS date, COUNT(*) AS count
             FROM review_log ${where}
             GROUP BY date ORDER BY date`,
        )
        .all(...args) as { date: string; count: number }[];
    },

    /** Global N-day workload forecast from card due dates (F1753). */
    forecast(now: string, days = 30): { day: number; count: number }[] {
      const nowMs = new Date(now).getTime();
      const rows = db
        .prepare(
          `SELECT due FROM cards
           WHERE state IN ('review', 'relearning', 'learning') AND due IS NOT NULL`,
        )
        .all() as { due: string }[];
      const forecast = Array.from({ length: days }, (_, d) => ({ day: d, count: 0 }));
      for (const r of rows) {
        const offset = Math.max(0, Math.floor((new Date(r.due).getTime() - nowMs) / MS_PER_DAY));
        if (offset < days) forecast[offset]!.count++;
      }
      return forecast;
    },

    /** Difficulty distribution histogram over 10 buckets, 1–10 (F1754). */
    difficultyDistribution(): { bucket: number; count: number }[] {
      const buckets = Array.from({ length: 10 }, (_, i) => ({ bucket: i + 1, count: 0 }));
      const rows = db
        .prepare('SELECT difficulty FROM cards WHERE difficulty IS NOT NULL')
        .all() as { difficulty: number }[];
      for (const r of rows) {
        const b = Math.min(9, Math.max(0, Math.floor(r.difficulty) - 1));
        buckets[b]!.count++;
      }
      return buckets;
    },

    /** Leeches: cards with many lapses, plus a remediation hint (F1755). */
    leeches(minLapses = 4): { id: string; prompt: string; lapses: number; suggestion: string }[] {
      const rows = db
        .prepare(
          'SELECT id, prompt, lapses FROM cards WHERE lapses >= ? ORDER BY lapses DESC LIMIT 200',
        )
        .all(minLapses) as { id: string; prompt: string; lapses: number }[];
      return rows.map((r) => ({
        ...r,
        suggestion:
          r.lapses >= 8
            ? 'Rewrite or split this card — it has lapsed too many times to be memorable as-is.'
            : 'Add a mnemonic or more context, or suspend until you can rework it.',
      }));
    },

    /** Knowledge coverage: which notes have cards (F1757). */
    coverage(): {
      notes: number;
      notesWithCards: number;
      notesWithoutCards: number;
      cards: number;
    } {
      const notes = (
        db.prepare('SELECT COUNT(*) AS n FROM notes WHERE trashed_at IS NULL').get() as {
          n: number;
        }
      ).n;
      const withCards = (
        db
          .prepare('SELECT COUNT(DISTINCT note_id) AS n FROM cards WHERE note_id IS NOT NULL')
          .get() as { n: number }
      ).n;
      const cards = (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n;
      return {
        notes,
        notesWithCards: withCards,
        notesWithoutCards: Math.max(0, notes - withCards),
        cards,
      };
    },

    /**
     * Current review streak (F1758): consecutive days up to `now` with at least
     * one review. Counts back from today; a gap ends the streak.
     */
    streak(now: string): { current: number; longest: number } {
      const days = new Set(
        (
          db.prepare('SELECT DISTINCT substr(reviewed_at, 1, 10) AS d FROM review_log').all() as {
            d: string;
          }[]
        ).map((r) => r.d),
      );
      // Current streak: walk back from today.
      let current = 0;
      let cursor = new Date(dayKey(now) + 'T00:00:00.000Z').getTime();
      while (days.has(dayKey(new Date(cursor).toISOString()))) {
        current++;
        cursor -= MS_PER_DAY;
      }
      // Longest streak across all reviewed days.
      const sorted = [...days].sort();
      let longest = 0;
      let run = 0;
      let prevMs: number | null = null;
      for (const d of sorted) {
        const ms = new Date(d + 'T00:00:00.000Z').getTime();
        if (prevMs !== null && ms - prevMs === MS_PER_DAY) run++;
        else run = 1;
        if (run > longest) longest = run;
        prevMs = ms;
      }
      return { current, longest };
    },

    /** Bundle every insight for export (F1759). */
    exportAll(now: string): Record<string, unknown> {
      return {
        generatedAt: now,
        trueRetention: this.trueRetention(),
        heatmap: this.heatmap(),
        forecast: this.forecast(now),
        difficulty: this.difficultyDistribution(),
        leeches: this.leeches(),
        coverage: this.coverage(),
        streak: this.streak(now),
      };
    },
  };
}

export type LearningInsightsRepo = ReturnType<typeof learningInsightsRepo>;
