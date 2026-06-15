/**
 * Learning insights tests (F1751–F1758).
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../connection.js';
import { migrate } from '../migrate.js';
import { learningInsightsRepo } from './learning-insights.js';
import { cardsRepo } from './cards.js';
import { RATING } from '../../learning/fsrs.js';

function fresh() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

describe('trueRetention (F1751)', () => {
  it('counts recall on review-state cards only', () => {
    const db = fresh();
    const cards = cardsRepo(db);
    const insights = learningInsightsRepo(db);

    const c = cards.create({ prompt: 'q', answer: 'a' });
    cards.review(c.id, RATING.Good, '2026-06-15T10:00:00.000Z'); // first (state_before new) — excluded
    cards.review(c.id, RATING.Good, '2026-06-20T10:00:00.000Z'); // recalled
    cards.review(c.id, RATING.Again, '2026-06-25T10:00:00.000Z'); // lapse

    const r = insights.trueRetention();
    expect(r.reviews).toBe(2); // the two review/relearning-state reviews
    expect(r.recalled).toBe(1);
    expect(r.retention).toBeCloseTo(0.5);
  });
});

describe('heatmap + streak (F1752/F1758)', () => {
  it('buckets reviews by day and computes the streak', () => {
    const db = fresh();
    const cards = cardsRepo(db);
    const insights = learningInsightsRepo(db);
    const c = cards.create({ prompt: 'q', answer: 'a' });
    cards.review(c.id, RATING.Good, '2026-06-14T09:00:00.000Z');
    cards.review(c.id, RATING.Good, '2026-06-15T09:00:00.000Z');

    const heat = insights.heatmap();
    expect(heat.find((d) => d.date === '2026-06-15')?.count).toBe(1);

    const streak = insights.streak('2026-06-15T20:00:00.000Z');
    expect(streak.current).toBe(2); // 14th + 15th
    expect(streak.longest).toBeGreaterThanOrEqual(2);
  });
});

describe('difficulty + leeches (F1754/F1755)', () => {
  it('distributes difficulty and flags leeches with a suggestion', () => {
    const db = fresh();
    const cards = cardsRepo(db);
    const insights = learningInsightsRepo(db);
    const c = cards.create({ prompt: 'leech', answer: 'a' });
    // Lapse it repeatedly.
    cards.review(c.id, RATING.Good, '2026-06-01T10:00:00.000Z');
    for (let i = 0; i < 5; i++) {
      cards.review(c.id, RATING.Again, `2026-06-${String(2 + i).padStart(2, '0')}T10:00:00.000Z`);
    }
    const dist = insights.difficultyDistribution();
    expect(dist.reduce((n, b) => n + b.count, 0)).toBe(1);

    const leeches = insights.leeches(4);
    expect(leeches).toHaveLength(1);
    expect(leeches[0]!.suggestion.length).toBeGreaterThan(0);
  });
});

describe('coverage + forecast + export (F1757/F1753/F1759)', () => {
  it('reports coverage and bundles an export', () => {
    const db = fresh();
    const cards = cardsRepo(db);
    const insights = learningInsightsRepo(db);
    cards.create({ prompt: 'q', answer: 'a' });

    const cov = insights.coverage();
    expect(cov.cards).toBe(1);

    const all = insights.exportAll('2026-06-15T10:00:00.000Z');
    expect(all.trueRetention).toBeDefined();
    expect(all.coverage).toBeDefined();
    expect(Array.isArray(all.forecast as unknown[])).toBe(true);
  });
});
