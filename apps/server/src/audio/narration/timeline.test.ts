/**
 * Tests for the narration timeline (F1626).
 */

import { describe, it, expect } from 'vitest';
import { buildTimeline, itemAtTime, timeOfItem } from './timeline.js';
import type { AudioScene } from './scene.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScene(durations: number[]): AudioScene {
  const items = durations.map((d, i) => ({
    kind: 'line' as const,
    knot: 'test',
    text: `Item ${i}`,
    speaker: null,
    voice: null,
    estDurationMs: d,
  }));
  const totalEstMs = durations.reduce((s, d) => s + d, 0);
  return { items, totalEstMs };
}

const emptyScene: AudioScene = { items: [], totalEstMs: 0 };

// ---------------------------------------------------------------------------
// buildTimeline
// ---------------------------------------------------------------------------

describe('buildTimeline', () => {
  it('returns empty entries and totalMs=0 for an empty scene', () => {
    const tl = buildTimeline(emptyScene);
    expect(tl.entries).toHaveLength(0);
    expect(tl.totalMs).toBe(0);
  });

  it('builds contiguous entries for a single-item scene', () => {
    const tl = buildTimeline(makeScene([1000]));
    expect(tl.entries).toHaveLength(1);
    expect(tl.entries[0]).toEqual({ index: 0, startMs: 0, endMs: 1000 });
    expect(tl.totalMs).toBe(1000);
  });

  it('entries are contiguous: each startMs equals the previous endMs', () => {
    const tl = buildTimeline(makeScene([500, 300, 700]));
    expect(tl.entries[0]).toEqual({ index: 0, startMs: 0, endMs: 500 });
    expect(tl.entries[1]).toEqual({ index: 1, startMs: 500, endMs: 800 });
    expect(tl.entries[2]).toEqual({ index: 2, startMs: 800, endMs: 1500 });
    expect(tl.totalMs).toBe(1500);
  });

  it('totalMs equals the last entry endMs', () => {
    const tl = buildTimeline(makeScene([100, 200, 300]));
    const last = tl.entries[tl.entries.length - 1]!;
    expect(tl.totalMs).toBe(last.endMs);
  });

  it('handles zero-duration items (earcons)', () => {
    const tl = buildTimeline(makeScene([400, 0, 600]));
    expect(tl.entries[0]).toEqual({ index: 0, startMs: 0, endMs: 400 });
    expect(tl.entries[1]).toEqual({ index: 1, startMs: 400, endMs: 400 });
    expect(tl.entries[2]).toEqual({ index: 2, startMs: 400, endMs: 1000 });
    expect(tl.totalMs).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// itemAtTime
// ---------------------------------------------------------------------------

describe('itemAtTime', () => {
  it('returns -1 for an empty scene', () => {
    const tl = buildTimeline(emptyScene);
    expect(itemAtTime(tl, 0)).toBe(-1);
    expect(itemAtTime(tl, 500)).toBe(-1);
  });

  it('clamps negative ms to index 0', () => {
    const tl = buildTimeline(makeScene([500, 500]));
    expect(itemAtTime(tl, -1)).toBe(0);
    expect(itemAtTime(tl, -9999)).toBe(0);
  });

  it('clamps ms >= totalMs to last index', () => {
    const tl = buildTimeline(makeScene([500, 500]));
    expect(itemAtTime(tl, 1000)).toBe(1);
    expect(itemAtTime(tl, 9999)).toBe(1);
  });

  it('returns 0 at exact startMs of first item', () => {
    const tl = buildTimeline(makeScene([300, 700]));
    expect(itemAtTime(tl, 0)).toBe(0);
  });

  it('returns 1 at exact startMs of second item', () => {
    const tl = buildTimeline(makeScene([300, 700]));
    expect(itemAtTime(tl, 300)).toBe(1);
  });

  it('finds the correct item at interior ms values', () => {
    const tl = buildTimeline(makeScene([100, 200, 300]));
    expect(itemAtTime(tl, 50)).toBe(0);
    expect(itemAtTime(tl, 100)).toBe(1);
    expect(itemAtTime(tl, 250)).toBe(1);
    expect(itemAtTime(tl, 300)).toBe(2);
    expect(itemAtTime(tl, 599)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// timeOfItem
// ---------------------------------------------------------------------------

describe('timeOfItem', () => {
  it('returns 0 for empty timeline', () => {
    const tl = buildTimeline(emptyScene);
    expect(timeOfItem(tl, 0)).toBe(0);
  });

  it('returns 0 for out-of-range index', () => {
    const tl = buildTimeline(makeScene([500, 500]));
    expect(timeOfItem(tl, -1)).toBe(0);
    expect(timeOfItem(tl, 99)).toBe(0);
  });

  it('returns correct startMs for valid indices', () => {
    const tl = buildTimeline(makeScene([400, 600, 200]));
    expect(timeOfItem(tl, 0)).toBe(0);
    expect(timeOfItem(tl, 1)).toBe(400);
    expect(timeOfItem(tl, 2)).toBe(1000);
  });
});
