/**
 * Canvas perf tests (F1591 10k-object budget, F1599 telemetry).
 */

import { describe, expect, it } from 'vitest';
import { measureSpatialIndex } from './telemetry.js';
import type { SpatialEntry } from './spatial-index.js';

function grid(n: number): SpatialEntry<number>[] {
  const side = Math.ceil(Math.sqrt(n));
  return Array.from({ length: n }, (_, i) => {
    const x = (i % side) * 12;
    const y = Math.floor(i / side) * 12;
    return { bbox: { minX: x, minY: y, maxX: x + 10, maxY: y + 10 }, item: i };
  });
}

describe('canvas spatial perf (F1591/F1599)', () => {
  it('stays well within budget at 10k objects', () => {
    const sample = measureSpatialIndex(grid(10_000));
    expect(sample.objects).toBe(10_000);
    // Generous ceilings to catch pathological regressions without CI flakiness.
    expect(sample.indexBuildMs).toBeLessThan(2000);
    expect(sample.queryMs).toBeLessThan(200);
    expect(sample.hits).toBeGreaterThan(0);
  });

  it('a region query returns only nearby objects', () => {
    const sample = measureSpatialIndex(grid(10_000), {
      minX: 0,
      minY: 0,
      maxX: 50,
      maxY: 50,
    });
    // Far fewer than all 10k — the index pruned the rest.
    expect(sample.hits).toBeLessThan(100);
  });
});
