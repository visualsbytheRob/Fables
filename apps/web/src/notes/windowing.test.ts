import { describe, expect, it } from 'vitest';
import { computeWindow } from './windowing.js';

describe('computeWindow (F172)', () => {
  it('renders only the visible slice plus overscan', () => {
    const slice = computeWindow({
      scrollTop: 0,
      viewportHeight: 300,
      rowHeight: 72,
      count: 1000,
    });
    expect(slice.start).toBe(0);
    expect(slice.end).toBe(11); // ceil(300/72)+1 visible + 5 overscan
    expect(slice.padTop).toBe(0);
    expect(slice.padBottom).toBe((1000 - 11) * 72);
  });

  it('offsets with scroll and pads above', () => {
    const slice = computeWindow({
      scrollTop: 7200, // 100 rows down
      viewportHeight: 300,
      rowHeight: 72,
      count: 1000,
      overscan: 2,
    });
    expect(slice.start).toBe(98);
    expect(slice.end).toBe(108);
    expect(slice.padTop).toBe(98 * 72);
    expect(slice.padTop + (slice.end - slice.start) * 72 + slice.padBottom).toBe(1000 * 72);
  });

  it('clamps at the end of the list and handles empty lists', () => {
    const slice = computeWindow({
      scrollTop: 99999,
      viewportHeight: 300,
      rowHeight: 72,
      count: 20,
    });
    expect(slice.end).toBe(20);
    expect(slice.padBottom).toBe(0);
    expect(computeWindow({ scrollTop: 0, viewportHeight: 300, rowHeight: 72, count: 0 })).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
  });
});
