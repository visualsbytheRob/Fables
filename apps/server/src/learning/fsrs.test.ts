/**
 * FSRS-5 scheduler tests (F1708 properties, F1709 conformance, F1710 benchmark).
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  RATING,
  initialDifficulty,
  initialStability,
  intervalForRetention,
  retrievability,
  schedule,
  type FsrsState,
  type Rating,
} from './fsrs.js';

describe('forgetting-curve identities (F1709)', () => {
  it('retrievability is 1 at t=0 and exactly 0.9 at t=S', () => {
    expect(retrievability(0, 10)).toBeCloseTo(1, 10);
    // By definition S is the interval at which retrievability is 90%.
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 10);
    expect(retrievability(37, 37)).toBeCloseTo(0.9, 10);
  });

  it('the interval at 90% retention equals the stability', () => {
    expect(intervalForRetention(10, 0.9)).toBeCloseTo(10, 8);
    expect(intervalForRetention(100, 0.9)).toBeCloseTo(100, 6);
  });

  it('higher requested retention yields a shorter interval', () => {
    expect(intervalForRetention(50, 0.95)).toBeLessThan(intervalForRetention(50, 0.9));
  });
});

describe('initial seeds (F1709)', () => {
  it('initial stability is the per-grade weight', () => {
    for (const g of [1, 2, 3, 4] as Rating[]) {
      expect(initialStability(DEFAULT_PARAMS, g)).toBeCloseTo(DEFAULT_PARAMS[g - 1]!, 10);
    }
  });

  it('initial difficulty is ordered: Again hardest, Easy easiest', () => {
    const d1 = initialDifficulty(DEFAULT_PARAMS, RATING.Again);
    const d3 = initialDifficulty(DEFAULT_PARAMS, RATING.Good);
    const d4 = initialDifficulty(DEFAULT_PARAMS, RATING.Easy);
    expect(d1).toBeGreaterThan(d3);
    expect(d3).toBeGreaterThan(d4);
    expect(d4).toBeGreaterThanOrEqual(1);
    expect(d1).toBeLessThanOrEqual(10);
  });
});

describe('scheduling properties (F1708)', () => {
  it('a first Good review seeds stability and a >=1 day interval', () => {
    const r = schedule(null, RATING.Good, 0);
    expect(r.state.stability).toBeCloseTo(DEFAULT_PARAMS[2]!, 10);
    expect(r.intervalDays).toBeGreaterThanOrEqual(1);
  });

  it('better grades give longer intervals (Easy >= Good >= Hard)', () => {
    const prev: FsrsState = { stability: 10, difficulty: 5 };
    const hard = schedule(prev, RATING.Hard, 10);
    const good = schedule(prev, RATING.Good, 10);
    const easy = schedule(prev, RATING.Easy, 10);
    expect(easy.intervalDays).toBeGreaterThanOrEqual(good.intervalDays);
    expect(good.intervalDays).toBeGreaterThanOrEqual(hard.intervalDays);
  });

  it('Again lapses: stability never grows, difficulty rises', () => {
    const prev: FsrsState = { stability: 40, difficulty: 5 };
    const again = schedule(prev, RATING.Again, 40);
    expect(again.state.stability).toBeLessThanOrEqual(prev.stability);
    expect(again.state.difficulty).toBeGreaterThan(prev.difficulty);
  });

  it('repeated Good reviews grow stability monotonically', () => {
    let state: FsrsState | null = null;
    let lastStability = 0;
    const intervals: number[] = [];
    for (let i = 0; i < 8; i++) {
      const elapsed = state ? intervalForRetention(state.stability, 0.9) : 0;
      const r = schedule(state, RATING.Good, elapsed);
      expect(r.state.stability).toBeGreaterThanOrEqual(lastStability);
      lastStability = r.state.stability;
      intervals.push(r.intervalDays);
      state = r.state;
    }
    // Intervals should trend upward across successful reviews.
    expect(intervals[intervals.length - 1]!).toBeGreaterThan(intervals[0]!);
  });

  it('difficulty stays within [1, 10] under adversarial ratings', () => {
    let state: FsrsState | null = null;
    const ratings: Rating[] = [1, 4, 1, 1, 4, 4, 1, 3, 2, 1];
    for (const g of ratings) {
      const r = schedule(state, g, 3);
      expect(r.state.difficulty).toBeGreaterThanOrEqual(1);
      expect(r.state.difficulty).toBeLessThanOrEqual(10);
      expect(r.state.stability).toBeGreaterThan(0);
      state = r.state;
    }
  });

  it('respects the maximum interval cap', () => {
    const prev: FsrsState = { stability: 100_000, difficulty: 1 };
    const r = schedule(prev, RATING.Easy, 100_000, { maximumIntervalDays: 365 });
    expect(r.intervalDays).toBeLessThanOrEqual(365);
  });
});

describe('scheduler benchmark (F1710)', () => {
  it('schedules 100k cards well within budget', () => {
    const start = Date.now();
    let state: FsrsState | null = null;
    for (let i = 0; i < 100_000; i++) {
      const g = ((i % 4) + 1) as Rating;
      state = schedule(state, g, (i % 30) + 1).state;
    }
    expect(state).not.toBeNull();
    expect(Date.now() - start).toBeLessThan(5000);
  }, 30_000);
});
