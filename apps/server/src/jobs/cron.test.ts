import { describe, it, expect } from 'vitest';
import {
  parseCron,
  isValidCron,
  matches,
  nextRun,
  missedRuns,
  describe as describeCron,
} from './cron.js';

// ---------------------------------------------------------------------------
// parseCron
// ---------------------------------------------------------------------------

describe('parseCron', () => {
  it('parses a step wildcard expression', () => {
    const f = parseCron('*/15 * * * *');
    expect(f.minutes).toEqual([0, 15, 30, 45]);
    expect(f.hours).toHaveLength(24);
    expect(f.domRestricted).toBe(false);
    expect(f.dowRestricted).toBe(false);
  });

  it('parses a range in minutes field', () => {
    const f = parseCron('10-20 * * * *');
    expect(f.minutes).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('parses a comma-separated list in hours field', () => {
    const f = parseCron('0 9,12,17 * * *');
    expect(f.hours).toEqual([9, 12, 17]);
    expect(f.minutes).toEqual([0]);
  });

  it('parses a range with step', () => {
    const f = parseCron('0 */6 * * *');
    expect(f.hours).toEqual([0, 6, 12, 18]);
  });

  it('parses day-of-week restriction', () => {
    const f = parseCron('0 9 * * 1-5');
    expect(f.dowRestricted).toBe(true);
    expect(f.domRestricted).toBe(false);
    expect(f.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses day-of-month restriction', () => {
    const f = parseCron('0 0 15 * *');
    expect(f.domRestricted).toBe(true);
    expect(f.dowRestricted).toBe(false);
    expect(f.daysOfMonth).toEqual([15]);
  });

  it('parses a month list', () => {
    const f = parseCron('0 0 1 3,6,9,12 *');
    expect(f.months).toEqual([3, 6, 9, 12]);
  });

  it('throws on too few fields', () => {
    expect(() => parseCron('* * * *')).toThrow(/5 fields/);
  });

  it('throws on too many fields', () => {
    expect(() => parseCron('* * * * * *')).toThrow(/5 fields/);
  });

  it('throws on minute value out of range', () => {
    expect(() => parseCron('60 * * * *')).toThrow(/minute/);
  });

  it('throws on hour value out of range', () => {
    expect(() => parseCron('0 24 * * *')).toThrow(/hour/);
  });

  it('throws on month value out of range', () => {
    expect(() => parseCron('0 0 * 13 *')).toThrow(/month/);
  });

  it('throws on day-of-week value out of range', () => {
    expect(() => parseCron('0 0 * * 7')).toThrow(/day-of-week/);
  });

  it('throws on invalid field token', () => {
    expect(() => parseCron('abc * * * *')).toThrow(/Invalid minute/);
  });

  it('throws on step of 0', () => {
    expect(() => parseCron('*/0 * * * *')).toThrow(/step/i);
  });

  it('throws on range where start > end', () => {
    expect(() => parseCron('30-10 * * * *')).toThrow(/range start/);
  });
});

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

describe('parseCron aliases', () => {
  it('@hourly => 0 * * * *', () => {
    const f = parseCron('@hourly');
    expect(f.minutes).toEqual([0]);
    expect(f.hours).toHaveLength(24);
  });

  it('@daily => 0 0 * * *', () => {
    const f = parseCron('@daily');
    expect(f.minutes).toEqual([0]);
    expect(f.hours).toEqual([0]);
  });

  it('@midnight => same as @daily', () => {
    const daily = parseCron('@daily');
    const midnight = parseCron('@midnight');
    expect(midnight).toEqual(daily);
  });

  it('@weekly => 0 0 * * 0', () => {
    const f = parseCron('@weekly');
    expect(f.minutes).toEqual([0]);
    expect(f.hours).toEqual([0]);
    expect(f.dowRestricted).toBe(true);
    expect(f.daysOfWeek).toEqual([0]);
  });

  it('@monthly => 0 0 1 * *', () => {
    const f = parseCron('@monthly');
    expect(f.minutes).toEqual([0]);
    expect(f.hours).toEqual([0]);
    expect(f.domRestricted).toBe(true);
    expect(f.daysOfMonth).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// isValidCron
// ---------------------------------------------------------------------------

describe('isValidCron', () => {
  it('returns true for valid expressions', () => {
    expect(isValidCron('*/15 * * * *')).toBe(true);
    expect(isValidCron('@daily')).toBe(true);
    expect(isValidCron('0 9 * * 1-5')).toBe(true);
  });

  it('returns false for invalid expressions', () => {
    expect(isValidCron('60 * * * *')).toBe(false);
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('')).toBe(false);
    expect(isValidCron('* * * *')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matches
// ---------------------------------------------------------------------------

describe('matches', () => {
  // 2026-06-15 09:30 UTC is a Monday (dow=1)
  const mon0930 = new Date('2026-06-15T09:30:00Z');

  it('matches when all fields agree', () => {
    const f = parseCron('30 9 15 6 *');
    expect(matches(f, mon0930)).toBe(true);
  });

  it('does not match wrong minute', () => {
    const f = parseCron('0 9 * * *');
    expect(matches(f, mon0930)).toBe(false);
  });

  it('does not match wrong hour', () => {
    const f = parseCron('30 10 * * *');
    expect(matches(f, mon0930)).toBe(false);
  });

  it('does not match wrong month', () => {
    const f = parseCron('30 9 * 7 *');
    expect(matches(f, mon0930)).toBe(false);
  });

  it('matches day-of-week only', () => {
    // Monday = 1
    const f = parseCron('30 9 * * 1');
    expect(matches(f, mon0930)).toBe(true);
  });

  it('does not match wrong day-of-week', () => {
    const f = parseCron('30 9 * * 0');
    expect(matches(f, mon0930)).toBe(false);
  });

  it('OR semantics: matches when EITHER dom OR dow matches (dom matches, dow does not)', () => {
    // day=15, dow=Monday=1; restrict dom=15 AND dow=0(Sunday) => should match because dom=15 matches
    const f = parseCron('30 9 15 * 0');
    expect(f.domRestricted).toBe(true);
    expect(f.dowRestricted).toBe(true);
    expect(matches(f, mon0930)).toBe(true);
  });

  it('OR semantics: matches when EITHER dom OR dow matches (dow matches, dom does not)', () => {
    // day=15, dow=Monday=1; restrict dom=1 AND dow=1 => matches because dow=1 matches
    const f = parseCron('30 9 1 * 1');
    expect(matches(f, mon0930)).toBe(true);
  });

  it('OR semantics: no match when NEITHER dom nor dow matches', () => {
    // day=15(Mon), restrict dom=1 AND dow=0(Sun)
    const f = parseCron('30 9 1 * 0');
    expect(matches(f, mon0930)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// nextRun
// ---------------------------------------------------------------------------

describe('nextRun', () => {
  it('returns same day 09:00 when after 08:00', () => {
    const after = new Date('2026-06-15T08:00:00Z');
    const next = nextRun('0 9 * * *', after);
    expect(next.toISOString()).toBe('2026-06-15T09:00:00.000Z');
  });

  it('returns next day 09:00 when after 09:30', () => {
    const after = new Date('2026-06-15T09:30:00Z');
    const next = nextRun('0 9 * * *', after);
    expect(next.toISOString()).toBe('2026-06-16T09:00:00.000Z');
  });

  it('returns next matching minute for */15 * * * *', () => {
    // after 09:07 => next is 09:15
    const after = new Date('2026-06-15T09:07:00Z');
    const next = nextRun('*/15 * * * *', after);
    expect(next.toISOString()).toBe('2026-06-15T09:15:00.000Z');
  });

  it('returns exactly 09:00 when after is at 08:59', () => {
    const after = new Date('2026-06-15T08:59:00Z');
    const next = nextRun('0 9 * * *', after);
    expect(next.toISOString()).toBe('2026-06-15T09:00:00.000Z');
  });

  it('zeroes seconds and ms', () => {
    const after = new Date('2026-06-15T09:00:30.500Z');
    const next = nextRun('*/5 * * * *', after);
    expect(next.getUTCSeconds()).toBe(0);
    expect(next.getUTCMilliseconds()).toBe(0);
  });

  it('handles day-of-week: next Monday 09:00 from a Monday 10:00', () => {
    // 2026-06-15 is a Monday; 10:00 is past 09:00, so next is 2026-06-22 Monday
    const after = new Date('2026-06-15T10:00:00Z');
    const next = nextRun('0 9 * * 1', after);
    expect(next.toISOString()).toBe('2026-06-22T09:00:00.000Z');
  });

  it('handles @monthly: next 1st-of-month midnight', () => {
    const after = new Date('2026-06-15T00:00:00Z');
    const next = nextRun('@monthly', after);
    expect(next.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('throws on invalid expression', () => {
    expect(() => nextRun('bad expr', new Date())).toThrow();
  });
});

// ---------------------------------------------------------------------------
// missedRuns
// ---------------------------------------------------------------------------

describe('missedRuns', () => {
  it('returns correct number of missed hourly runs', () => {
    // @hourly fires at minute 0 each hour
    // window: 2026-06-15T00:00Z (lastRun) to 2026-06-15T06:00Z (now)
    // missed runs at 01:00, 02:00, 03:00, 04:00, 05:00, 06:00 = 6 runs
    const lastRun = new Date('2026-06-15T00:00:00Z');
    const now = new Date('2026-06-15T06:00:00Z');
    const runs = missedRuns('@hourly', lastRun, now);
    expect(runs).toHaveLength(6);
    expect(runs[0]!.toISOString()).toBe('2026-06-15T01:00:00.000Z');
    expect(runs[5]!.toISOString()).toBe('2026-06-15T06:00:00.000Z');
  });

  it('returns empty array when no missed runs', () => {
    // @daily fires at 00:00; lastRun=2026-06-15T00:00Z, now=2026-06-15T23:00Z
    // next would be 2026-06-16T00:00Z which is beyond now
    const lastRun = new Date('2026-06-15T00:00:00Z');
    const now = new Date('2026-06-15T23:00:00Z');
    const runs = missedRuns('@daily', lastRun, now);
    expect(runs).toHaveLength(0);
  });

  it('caps results at the cap parameter (most recent kept)', () => {
    // */1 fires every minute; 200 minutes window with cap=100
    const lastRun = new Date('2026-06-15T00:00:00Z');
    const now = new Date('2026-06-15T03:20:00Z'); // 200 minutes later
    const runs = missedRuns('* * * * *', lastRun, now, 100);
    expect(runs).toHaveLength(100);
    // Should be the most recent 100 entries (ending at now)
    expect(runs[99]!.toISOString()).toBe('2026-06-15T03:20:00.000Z');
  });

  it('caps at default of 100', () => {
    const lastRun = new Date('2026-06-15T00:00:00Z');
    const now = new Date('2026-06-15T03:20:00Z');
    const runs = missedRuns('* * * * *', lastRun, now);
    expect(runs).toHaveLength(100);
  });

  it('includes runs exactly at now boundary', () => {
    // @hourly; lastRun at 02:00, now at 03:00 => missed 03:00 is included
    const lastRun = new Date('2026-06-15T02:00:00Z');
    const now = new Date('2026-06-15T03:00:00Z');
    const runs = missedRuns('@hourly', lastRun, now);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.toISOString()).toBe('2026-06-15T03:00:00.000Z');
  });

  it('throws for windows exceeding 366 days', () => {
    const lastRun = new Date('2020-01-01T00:00:00Z');
    const now = new Date('2021-06-01T00:00:00Z');
    expect(() => missedRuns('* * * * *', lastRun, now)).toThrow(/366 days/);
  });
});

// ---------------------------------------------------------------------------
// describe
// ---------------------------------------------------------------------------

describe('describe (human-readable)', () => {
  it('describes @hourly', () => {
    expect(describeCron('@hourly')).toBe('At minute 0 of every hour');
  });

  it('describes @daily', () => {
    expect(describeCron('@daily')).toMatch(/midnight/i);
  });

  it('describes a complex expression without throwing', () => {
    // Just check it returns a non-empty string
    const result = describeCron('*/15 9-17 * * 1-5');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
