/**
 * Card scheduler glue (Epic 18, F1701/F1703) — bridges a stored card to the pure
 * FSRS-5 model. Given a card's current memory state and a rating, it produces the
 * next state, lifecycle, due date, and the review-log fields to persist.
 */

import { RATING, schedule, type Rating, type FsrsState, type ScheduleOptions } from './fsrs.js';

export type CardState = 'new' | 'learning' | 'review' | 'relearning' | 'suspended' | 'buried';

/** The mutable scheduling fields of a card. */
export interface ReviewableCard {
  state: CardState;
  stability: number | null;
  difficulty: number | null;
  due: string | null;
  reps: number;
  lapses: number;
  lastReview: string | null;
}

export interface ReviewOutcome {
  state: CardState;
  stability: number;
  difficulty: number;
  due: string;
  reps: number;
  lapses: number;
  lastReview: string;
  intervalDays: number;
  /** Fields for the review-log row. */
  log: {
    rating: Rating;
    stateBefore: CardState;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    reviewR: number | null;
  };
}

const MS_PER_DAY = 86_400_000;

const addDays = (iso: string, days: number): string =>
  new Date(new Date(iso).getTime() + days * MS_PER_DAY).toISOString();

const daysBetween = (from: string, to: string): number =>
  Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / MS_PER_DAY);

/**
 * Apply a rating to a card at time `now` (ISO), returning the next scheduling
 * state + the review-log fields. A card with no prior FSRS state is treated as a
 * first review (seeds stability/difficulty from the grade).
 */
export function reviewCard(
  card: ReviewableCard,
  rating: Rating,
  now: string,
  options: ScheduleOptions = {},
): ReviewOutcome {
  const hasState = card.stability !== null && card.difficulty !== null;
  const prev: FsrsState | null = hasState
    ? { stability: card.stability!, difficulty: card.difficulty! }
    : null;
  const elapsedDays = card.lastReview ? daysBetween(card.lastReview, now) : 0;

  const result = schedule(prev, rating, elapsedDays, options);

  const lapsed = prev !== null && rating === RATING.Again;
  const nextState: CardState = lapsed ? 'relearning' : 'review';

  return {
    state: nextState,
    stability: result.state.stability,
    difficulty: result.state.difficulty,
    due: addDays(now, result.intervalDays),
    reps: card.reps + 1,
    lapses: card.lapses + (lapsed ? 1 : 0),
    lastReview: now,
    intervalDays: result.intervalDays,
    log: {
      rating,
      stateBefore: card.state,
      stability: result.state.stability,
      difficulty: result.state.difficulty,
      elapsedDays,
      scheduledDays: result.intervalDays,
      reviewR: prev ? result.reviewR : null,
    },
  };
}
