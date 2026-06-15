/**
 * Canvas performance telemetry (F1599) — local perf stats only.
 *
 * Measures how the spatial index behaves at a given object count: build time and
 * a representative region query. Used to keep the canvas honest about the "usable
 * at 10k objects" target (F1591) and to surface local perf to the user — never
 * sent anywhere.
 */

import { SpatialIndex, type SpatialEntry } from './spatial-index.js';

export interface CanvasPerfSample {
  objects: number;
  /** Milliseconds to (re)build the spatial index. */
  indexBuildMs: number;
  /** Milliseconds for a representative region query. */
  queryMs: number;
  /** Objects returned by that query. */
  hits: number;
}

/** Build the index over `entries` and time a region query (F1599/F1591). */
export function measureSpatialIndex<T>(
  entries: SpatialEntry<T>[],
  query = { minX: 0, minY: 0, maxX: 500, maxY: 500 },
): CanvasPerfSample {
  const t0 = performance.now();
  const index = new SpatialIndex<T>().load(entries);
  const t1 = performance.now();
  const hits = index.search(query);
  const t2 = performance.now();
  return {
    objects: entries.length,
    indexBuildMs: t1 - t0,
    queryMs: t2 - t1,
    hits: hits.length,
  };
}
