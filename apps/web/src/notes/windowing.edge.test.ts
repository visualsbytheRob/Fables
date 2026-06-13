/**
 * F901/F902 — Additional windowing edge-case tests.
 * Covers very large lists, negative scroll, fractional heights, zero items.
 */
import { describe, expect, it } from 'vitest';
import { computeWindow } from './windowing.js';

describe('computeWindow edge cases (F901/F902)', () => {
  it('handles 10k-note vault with windowing math staying sub-linear', () => {
    const slice = computeWindow({
      scrollTop: 5_000 * 72,
      viewportHeight: 600,
      rowHeight: 72,
      count: 10_000,
      overscan: 3,
    });
    // Only a small slice should be rendered
    expect(slice.end - slice.start).toBeLessThan(20);
    expect(slice.start).toBeGreaterThan(4_990);
    expect(slice.padTop).toBe(slice.start * 72);
    expect(slice.padBottom).toBe((10_000 - slice.end) * 72);
  });

  it('returns zero slice for count=0', () => {
    const s = computeWindow({ scrollTop: 0, viewportHeight: 600, rowHeight: 72, count: 0 });
    expect(s).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });

  it('clamps negative scrollTop to zero', () => {
    const s = computeWindow({ scrollTop: -100, viewportHeight: 600, rowHeight: 72, count: 50 });
    expect(s.start).toBe(0);
  });

  it('handles scrollTop past the end gracefully', () => {
    const s = computeWindow({
      scrollTop: 99_999,
      viewportHeight: 600,
      rowHeight: 72,
      count: 100,
    });
    expect(s.end).toBe(100);
    expect(s.padBottom).toBe(0);
  });

  it('single-item list renders that item', () => {
    const s = computeWindow({ scrollTop: 0, viewportHeight: 300, rowHeight: 72, count: 1 });
    expect(s.start).toBe(0);
    expect(s.end).toBe(1);
  });

  it('padTop + rendered rows + padBottom = total height', () => {
    const count = 200;
    const rowHeight = 72;
    const s = computeWindow({ scrollTop: 1000, viewportHeight: 300, rowHeight, count });
    const renderedHeight = (s.end - s.start) * rowHeight;
    expect(s.padTop + renderedHeight + s.padBottom).toBe(count * rowHeight);
  });

  it('zero rowHeight returns empty slice without dividing by zero', () => {
    const s = computeWindow({ scrollTop: 0, viewportHeight: 300, rowHeight: 0, count: 50 });
    expect(s).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });
});
