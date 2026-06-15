/**
 * Card scheduler glue tests (F1701/F1703).
 */

import { describe, expect, it } from 'vitest';
import { reviewCard, type ReviewableCard } from './scheduler.js';
import { RATING } from './fsrs.js';

const NEW_CARD: ReviewableCard = {
  state: 'new',
  stability: null,
  difficulty: null,
  due: null,
  reps: 0,
  lapses: 0,
  lastReview: null,
};

describe('reviewCard', () => {
  it('first review seeds state, sets a future due date, and increments reps', () => {
    const now = '2026-06-15T10:00:00.000Z';
    const out = reviewCard(NEW_CARD, RATING.Good, now);
    expect(out.state).toBe('review');
    expect(out.stability).toBeGreaterThan(0);
    expect(out.difficulty).toBeGreaterThanOrEqual(1);
    expect(out.reps).toBe(1);
    expect(out.lapses).toBe(0);
    expect(new Date(out.due).getTime()).toBeGreaterThan(new Date(now).getTime());
    // No retrievability on a first review.
    expect(out.log.reviewR).toBeNull();
  });

  it('a lapse from review increments lapses and enters relearning', () => {
    const reviewed: ReviewableCard = {
      state: 'review',
      stability: 40,
      difficulty: 5,
      due: '2026-06-20T10:00:00.000Z',
      reps: 3,
      lapses: 0,
      lastReview: '2026-05-11T10:00:00.000Z',
    };
    const out = reviewCard(reviewed, RATING.Again, '2026-06-20T10:00:00.000Z');
    expect(out.state).toBe('relearning');
    expect(out.lapses).toBe(1);
    expect(out.stability).toBeLessThanOrEqual(40);
    expect(out.log.reviewR).not.toBeNull();
  });

  it('computes elapsed days from the last review', () => {
    const reviewed: ReviewableCard = {
      ...NEW_CARD,
      state: 'review',
      stability: 10,
      difficulty: 5,
      lastReview: '2026-06-10T10:00:00.000Z',
      reps: 1,
    };
    const out = reviewCard(reviewed, RATING.Good, '2026-06-20T10:00:00.000Z');
    expect(out.log.elapsedDays).toBeCloseTo(10, 5);
  });
});
