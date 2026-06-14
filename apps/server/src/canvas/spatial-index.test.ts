/**
 * Spatial-index tests (F1503) — correctness is proven by property-testing the
 * R-tree's results against a brute-force scan over random rectangles, plus the
 * point hit-test and empty cases.
 */

import { describe, expect, it } from 'vitest';
import { SpatialIndex, intersects, type BBox, type SpatialEntry } from './spatial-index.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function randomEntries(n: number, rand: () => number): SpatialEntry<number>[] {
  return Array.from({ length: n }, (_, i) => {
    const x = rand() * 1000;
    const y = rand() * 1000;
    const w = rand() * 40;
    const h = rand() * 40;
    return { bbox: { minX: x, minY: y, maxX: x + w, maxY: y + h }, item: i };
  });
}

const bruteForce = (entries: SpatialEntry<number>[], q: BBox): Set<number> =>
  new Set(entries.filter((e) => intersects(e.bbox, q)).map((e) => e.item));

describe('SpatialIndex (F1503)', () => {
  it('matches brute force over many random queries', () => {
    const rand = rng(42);
    const entries = randomEntries(2000, rand);
    const index = new SpatialIndex<number>().load(entries);
    expect(index.size).toBe(2000);

    for (let t = 0; t < 200; t += 1) {
      const x = rand() * 1000;
      const y = rand() * 1000;
      const q: BBox = { minX: x, minY: y, maxX: x + rand() * 200, maxY: y + rand() * 200 };
      const got = new Set(index.search(q));
      expect(got).toEqual(bruteForce(entries, q));
    }
  });

  it('hit-tests a point', () => {
    const index = new SpatialIndex<string>().load([
      { bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, item: 'a' },
      { bbox: { minX: 100, minY: 100, maxX: 110, maxY: 110 }, item: 'b' },
    ]);
    expect(index.hitTest(5, 5)).toEqual(['a']);
    expect(index.hitTest(50, 50)).toEqual([]);
  });

  it('handles the empty index', () => {
    const index = new SpatialIndex<number>().load([]);
    expect(index.size).toBe(0);
    expect(index.search({ minX: 0, minY: 0, maxX: 1, maxY: 1 })).toEqual([]);
  });
});
