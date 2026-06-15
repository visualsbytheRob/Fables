/**
 * Narration Renderer — Timeline (F1626).
 *
 * Maps play-time millisecond offsets to/from scene item indices.
 * Pure module — no I/O.
 */

import type { AudioScene } from './scene.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  index: number;
  startMs: number;
  endMs: number;
}

export interface Timeline {
  entries: TimelineEntry[];
  totalMs: number;
}

// ---------------------------------------------------------------------------
// Main exports
// ---------------------------------------------------------------------------

/**
 * Build a contiguous timeline from an AudioScene.
 *
 * entry[i].startMs = sum of prior item durations.
 * entry[i].endMs   = startMs + item.estDurationMs.
 * totalMs          = last entry's endMs (0 when the scene is empty).
 */
export function buildTimeline(scene: AudioScene): Timeline {
  const entries: TimelineEntry[] = [];
  let cursor = 0;

  for (let i = 0; i < scene.items.length; i++) {
    const item = scene.items[i]!;
    const startMs = cursor;
    const endMs = startMs + item.estDurationMs;
    entries.push({ index: i, startMs, endMs });
    cursor = endMs;
  }

  return { entries, totalMs: cursor };
}

/**
 * Return the index of the scene item playing at `ms`.
 *
 * Clamping rules:
 *   - Empty scene → -1.
 *   - ms < 0 → index of the first item (0).
 *   - ms >= totalMs → index of the last item.
 *   - Otherwise: the entry whose [startMs, endMs) contains ms.
 */
export function itemAtTime(tl: Timeline, ms: number): number {
  if (tl.entries.length === 0) return -1;

  const last = tl.entries[tl.entries.length - 1]!;

  if (ms < 0) return 0;
  if (ms >= tl.totalMs) return last.index;

  // Linear scan — scenes are typically short enough that binary search is
  // overkill, but entries are contiguous so the first matching window wins.
  for (const entry of tl.entries) {
    if (ms >= entry.startMs && ms < entry.endMs) {
      return entry.index;
    }
  }

  // Fallback (shouldn't be reached for valid timelines).
  return last.index;
}

/**
 * Return the start time in ms of the item at `index`.
 *
 * Returns 0 when the timeline is empty or `index` is out of range.
 */
export function timeOfItem(tl: Timeline, index: number): number {
  const entry = tl.entries[index];
  return entry !== undefined ? entry.startMs : 0;
}
