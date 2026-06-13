// @vitest-environment jsdom
/**
 * F971–F979 — Local analytics store tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activityByHour,
  isOptedOut,
  loadClientErrors,
  loadCounters,
  loadHourlyActivity,
  loadSlowOps,
  opPercentiles,
  purgeAll,
  purgeOlderThan,
  recordActivity,
  recordClientError,
  recordFeatureUse,
  recordSlowOp,
  setOptOut,
  topFeatures,
} from './analyticsStore.js';

beforeEach(() => {
  localStorage.clear();
  // Ensure not opted out before each test
  setOptOut(false);
});
afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

// ── Opt-out (F978) ──────────────────────────────
describe('opt-out (F978)', () => {
  it('defaults to opted in', () => {
    expect(isOptedOut()).toBe(false);
  });

  it('setOptOut(true) prevents recording and clears data', () => {
    recordFeatureUse('search');
    expect(Object.keys(loadCounters()).length).toBe(1);

    setOptOut(true);
    expect(isOptedOut()).toBe(true);

    // Recording while opted out is a no-op
    recordFeatureUse('notes.create');
    expect(Object.keys(loadCounters()).length).toBe(0); // purged

    // Re-opt-in
    setOptOut(false);
    expect(isOptedOut()).toBe(false);
  });
});

// ── Feature counters (F971) ──────────────────────
describe('feature counters (F971)', () => {
  it('increments counter per feature', () => {
    recordFeatureUse('search');
    recordFeatureUse('search');
    recordFeatureUse('notes.create');

    const counters = loadCounters();
    expect(counters['search']!.count).toBe(2);
    expect(counters['notes.create']!.count).toBe(1);
  });

  it('records lastUsedAt as recent ISO string', () => {
    recordFeatureUse('forge.compile');
    const counters = loadCounters();
    const ts = new Date(counters['forge.compile']!.lastUsedAt);
    expect(Number.isNaN(ts.getTime())).toBe(false);
    expect(Date.now() - ts.getTime()).toBeLessThan(5000);
  });

  it('topFeatures returns sorted descending', () => {
    for (let i = 0; i < 5; i++) recordFeatureUse('a');
    for (let i = 0; i < 3; i++) recordFeatureUse('b');
    recordFeatureUse('c');

    const top = topFeatures(2);
    expect(top[0]!.id).toBe('a');
    expect(top[1]!.id).toBe('b');
    expect(top.length).toBe(2);
  });
});

// ── Hourly activity (F972) ───────────────────────
describe('hourly activity (F972)', () => {
  it('records activity buckets and groups by hour of day', () => {
    recordActivity();
    recordActivity();
    const buckets = loadHourlyActivity();
    expect(buckets.length).toBe(1);
    expect(buckets[0]!.count).toBe(2);

    const byHour = activityByHour();
    const currentHour = new Date().getUTCHours();
    expect(byHour[currentHour]).toBe(2);
  });

  it('no-ops when opted out', () => {
    setOptOut(true);
    recordActivity();
    setOptOut(false);
    expect(loadHourlyActivity().length).toBe(0);
  });
});

// ── Slow ops / performance (F975) ────────────────
describe('slow ops and percentiles (F975)', () => {
  it('records ops above threshold only', () => {
    recordSlowOp('search', 200); // below threshold
    recordSlowOp('search', 800);
    recordSlowOp('search', 1200);

    const ops = loadSlowOps();
    expect(ops.length).toBe(2);
    expect(ops.every((o) => o.durationMs >= 500)).toBe(true);
  });

  it('computes percentiles correctly', () => {
    for (let i = 1; i <= 100; i++) {
      recordSlowOp('compile', i * 10 + 490); // 500–1490ms (all above threshold)
    }
    const p = opPercentiles('compile');
    expect(p).not.toBeNull();
    // p50 ≈ 1000ms (50th item of 100 * 10 = 1000ms + 490 = 990ms)
    expect(p!.p50).toBeGreaterThanOrEqual(980);
    expect(p!.p99).toBeGreaterThan(p!.p50);
  });

  it('returns null percentiles for unknown op', () => {
    expect(opPercentiles('unknown')).toBeNull();
  });

  it('no-ops when opted out', () => {
    setOptOut(true);
    recordSlowOp('search', 1000);
    setOptOut(false);
    expect(loadSlowOps().length).toBe(0);
  });
});

// ── Error aggregation (F976) ────────────────────
describe('error aggregation (F976)', () => {
  it('aggregates duplicate errors by message', () => {
    recordClientError('TypeError: null');
    recordClientError('TypeError: null');
    recordClientError('RangeError: too big');

    const errors = loadClientErrors();
    expect(errors.length).toBe(2);
    const typeErr = errors.find((e) => e.message === 'TypeError: null');
    expect(typeErr!.count).toBe(2);
  });

  it('stores stack trace', () => {
    recordClientError('SyntaxError', 'at foo.ts:10');
    const errors = loadClientErrors();
    expect(errors[0]!.stack).toBe('at foo.ts:10');
  });

  it('no-ops when opted out', () => {
    setOptOut(true);
    recordClientError('test error');
    setOptOut(false);
    expect(loadClientErrors().length).toBe(0);
  });
});

// ── Purge (F977) ────────────────────────────────
describe('data purge (F977)', () => {
  it('purgeAll wipes everything', () => {
    recordFeatureUse('x');
    recordActivity();
    recordSlowOp('op', 1000);
    recordClientError('err');

    purgeAll();
    expect(Object.keys(loadCounters()).length).toBe(0);
    expect(loadHourlyActivity().length).toBe(0);
    expect(loadSlowOps().length).toBe(0);
    expect(loadClientErrors().length).toBe(0);
  });

  it('purgeOlderThan(0) keeps current-day data', () => {
    recordActivity();
    recordSlowOp('op', 1000);
    recordClientError('recent');

    purgeOlderThan(0);
    // Records from this exact moment survive the 0-day cutoff
    expect(loadHourlyActivity().length).toBe(1);
  });
});

// ── Privacy: no network calls (F979) ───────────────
describe('privacy: no network calls (F979)', () => {
  it('never calls fetch', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    recordFeatureUse('notes.create');
    recordActivity();
    recordSlowOp('op', 600);
    recordClientError('boom');

    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
