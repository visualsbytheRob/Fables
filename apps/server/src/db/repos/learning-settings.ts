/**
 * Learning settings repository (Epic 18, F1764–F1768).
 *
 * One JSON row (migration 037): vacation mode, daily caps, relearning steps, the
 * global max-interval + retention, and per-card priority overrides.
 */

import type { Db } from '../connection.js';

export interface LearningSettings {
  /** F1764: when set (ISO) and in the future, reviews are paused until then. */
  vacationUntil: string | null;
  /** F1765: catch-up caps. */
  dailyNewCap: number;
  dailyReviewCap: number;
  /** F1768: re-learning step intervals in minutes (e.g. [10, 1440]). */
  relearningSteps: number[];
  /** F1767: global interval cap in days. */
  maxIntervalDays: number;
  /** Global FSRS target retention. */
  requestRetention: number;
  /** F1766: cardId → priority (higher sorts earlier in a session). */
  priorityOverrides: Record<string, number>;
}

export const DEFAULT_LEARNING_SETTINGS: LearningSettings = {
  vacationUntil: null,
  dailyNewCap: 20,
  dailyReviewCap: 200,
  relearningSteps: [10, 1440],
  maxIntervalDays: 365 * 100,
  requestRetention: 0.9,
  priorityOverrides: {},
};

export function learningSettingsRepo(db: Db) {
  return {
    get(): LearningSettings {
      const row = db.prepare('SELECT data FROM learning_settings WHERE id = 1').get() as
        | { data: string }
        | undefined;
      if (!row)
        return {
          ...DEFAULT_LEARNING_SETTINGS,
          relearningSteps: [...DEFAULT_LEARNING_SETTINGS.relearningSteps],
          priorityOverrides: {},
        };
      try {
        const parsed = JSON.parse(row.data) as Partial<LearningSettings>;
        return {
          vacationUntil: parsed.vacationUntil ?? null,
          dailyNewCap: parsed.dailyNewCap ?? DEFAULT_LEARNING_SETTINGS.dailyNewCap,
          dailyReviewCap: parsed.dailyReviewCap ?? DEFAULT_LEARNING_SETTINGS.dailyReviewCap,
          relearningSteps: parsed.relearningSteps ?? [...DEFAULT_LEARNING_SETTINGS.relearningSteps],
          maxIntervalDays: parsed.maxIntervalDays ?? DEFAULT_LEARNING_SETTINGS.maxIntervalDays,
          requestRetention: parsed.requestRetention ?? DEFAULT_LEARNING_SETTINGS.requestRetention,
          priorityOverrides: parsed.priorityOverrides ?? {},
        };
      } catch {
        return {
          ...DEFAULT_LEARNING_SETTINGS,
          relearningSteps: [...DEFAULT_LEARNING_SETTINGS.relearningSteps],
          priorityOverrides: {},
        };
      }
    },

    update(patch: Partial<LearningSettings>): LearningSettings {
      const next = { ...this.get(), ...patch };
      db.prepare(
        `INSERT INTO learning_settings (id, data) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      ).run(JSON.stringify(next));
      return next;
    },

    /** Whether reviews are paused right now (F1764). */
    onVacation(now: string): boolean {
      const v = this.get().vacationUntil;
      return v !== null && v > now;
    },
  };
}

export type LearningSettingsRepo = ReturnType<typeof learningSettingsRepo>;
