/**
 * Undo + session-summary tests (F1728/F1729).
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../connection.js';
import { migrate } from '../migrate.js';
import { cardsRepo } from './cards.js';
import { RATING } from '../../learning/fsrs.js';

function freshRepo() {
  const db = openDb(':memory:');
  migrate(db);
  return cardsRepo(db);
}

describe('undoLastReview (F1728)', () => {
  it('undoing the first review returns the card to new', () => {
    const repo = freshRepo();
    const card = repo.create({ prompt: 'q', answer: 'a' });
    repo.review(card.id, RATING.Good, '2026-06-15T10:00:00.000Z');
    expect(repo.get(card.id)!.state).toBe('review');

    const undone = repo.undoLastReview(card.id)!;
    expect(undone.state).toBe('new');
    expect(undone.stability).toBeNull();
    expect(undone.reps).toBe(0);
    expect(repo.reviewLog(card.id)).toHaveLength(0);
  });

  it('undoing a later review restores the prior memory state', () => {
    const repo = freshRepo();
    const card = repo.create({ prompt: 'q', answer: 'a' });
    const afterFirst = repo.review(card.id, RATING.Good, '2026-06-15T10:00:00.000Z')!;
    repo.review(card.id, RATING.Easy, '2026-06-20T10:00:00.000Z');
    expect(repo.reviewLog(card.id)).toHaveLength(2);

    const undone = repo.undoLastReview(card.id)!;
    expect(undone.reps).toBe(1);
    expect(undone.stability).toBeCloseTo(afterFirst.stability!, 6);
    expect(repo.reviewLog(card.id)).toHaveLength(1);
  });

  it('returns null when there is nothing to undo', () => {
    const repo = freshRepo();
    const card = repo.create({ prompt: 'q', answer: 'a' });
    expect(repo.undoLastReview(card.id)).toBeNull();
  });

  it('decrements lapses when undoing an Again', () => {
    const repo = freshRepo();
    const card = repo.create({ prompt: 'q', answer: 'a' });
    repo.review(card.id, RATING.Good, '2026-06-15T10:00:00.000Z');
    repo.review(card.id, RATING.Again, '2026-06-25T10:00:00.000Z');
    expect(repo.get(card.id)!.lapses).toBe(1);
    const undone = repo.undoLastReview(card.id)!;
    expect(undone.lapses).toBe(0);
  });
});

describe('sessionSummary (F1729)', () => {
  it('counts reviews by rating and distinct cards in a window', () => {
    const repo = freshRepo();
    const a = repo.create({ prompt: '1', answer: '1' });
    const b = repo.create({ prompt: '2', answer: '2' });
    repo.review(a.id, RATING.Good, '2026-06-15T10:00:00.000Z');
    repo.review(a.id, RATING.Easy, '2026-06-15T10:05:00.000Z');
    repo.review(b.id, RATING.Again, '2026-06-15T10:10:00.000Z');

    const summary = repo.sessionSummary('2026-06-15T00:00:00.000Z');
    expect(summary.reviews).toBe(3);
    expect(summary.cards).toBe(2);
    expect(summary.byRating.good).toBe(1);
    expect(summary.byRating.easy).toBe(1);
    expect(summary.byRating.again).toBe(1);

    // A window after the reviews sees nothing.
    expect(repo.sessionSummary('2026-07-01T00:00:00.000Z').reviews).toBe(0);
  });
});
