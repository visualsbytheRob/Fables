/**
 * Habit helper tests (F1773/F1775/F1776/F1777).
 */

import { describe, expect, it } from 'vitest';
import {
  bestReviewHour,
  pickReminder,
  weeklyDigest,
  inQuietHours,
  REMINDER_VARIANTS,
} from './habits.js';

describe('bestReviewHour (F1773)', () => {
  it('finds the most common review hour', () => {
    const ts = [
      '2026-06-15T08:00:00.000Z',
      '2026-06-15T08:30:00.000Z',
      '2026-06-16T08:15:00.000Z',
      '2026-06-16T20:00:00.000Z',
    ];
    expect(bestReviewHour(ts)).toEqual({ hour: 8, count: 3 });
    expect(bestReviewHour([])).toBeNull();
  });
});

describe('pickReminder (F1777)', () => {
  it('returns null when nothing is due', () => {
    expect(pickReminder(0, 5)).toBeNull();
  });
  it('returns an encouraging variant when due', () => {
    const r = pickReminder(3, 4, 0);
    expect(r).not.toBeNull();
    expect(REMINDER_VARIANTS).toContain(r!.text);
    expect(r!.dueCount).toBe(3);
  });
});

describe('inQuietHours (F1776)', () => {
  it('handles windows that wrap past midnight', () => {
    // 22:00 → 07:00
    expect(inQuietHours('2026-06-15T23:00:00.000Z', 22, 7)).toBe(true);
    expect(inQuietHours('2026-06-15T03:00:00.000Z', 22, 7)).toBe(true);
    expect(inQuietHours('2026-06-15T12:00:00.000Z', 22, 7)).toBe(false);
  });
  it('handles same-day windows and the disabled case', () => {
    expect(inQuietHours('2026-06-15T13:00:00.000Z', 9, 17)).toBe(true);
    expect(inQuietHours('2026-06-15T20:00:00.000Z', 9, 17)).toBe(false);
    expect(inQuietHours('2026-06-15T13:00:00.000Z', 0, 0)).toBe(false);
  });
});

describe('weeklyDigest (F1775)', () => {
  it('renders a friendly markdown digest', () => {
    const md = weeklyDigest(
      { reviews: 42, retention: 0.91, streak: 5, newCards: 10, dueTomorrow: 7 },
      '2026-06-15T00:00:00.000Z',
    );
    expect(md).toContain('# Weekly learning digest');
    expect(md).toContain('**42**');
    expect(md).toContain('91%');
    expect(md).toContain('5 days');
  });
});
