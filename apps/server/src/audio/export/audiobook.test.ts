/**
 * Audiobook manifest tests (F1661/F1662/F1663/F1668/F1669).
 */

import { describe, expect, it } from 'vitest';
import {
  buildAudiobookManifest,
  buildChapters,
  estimateAudioBytes,
  toCueSheet,
} from './audiobook.js';
import type { AudioScene, SceneItem } from '../narration/scene.js';

function item(knot: string, ms: number): SceneItem {
  return { kind: 'line', knot, text: 't', speaker: null, voice: null, estDurationMs: ms };
}

function scene(items: SceneItem[]): AudioScene {
  return { items, totalEstMs: items.reduce((n, i) => n + i.estDurationMs, 0) };
}

describe('buildChapters (F1662)', () => {
  it('one chapter per contiguous knot, timed from item durations', () => {
    const s = scene([
      item('intro', 1000),
      item('intro', 500),
      item('forest_clearing', 2000),
      item('intro', 800), // re-entry → a new chapter
    ]);
    const chapters = buildChapters(s);
    expect(chapters.map((c) => c.knot)).toEqual(['intro', 'forest_clearing', 'intro']);
    expect(chapters[0]!.startMs).toBe(0);
    expect(chapters[0]!.endMs).toBe(1500);
    expect(chapters[1]!.startMs).toBe(1500);
    expect(chapters[1]!.endMs).toBe(3500);
    // Titleized knot id.
    expect(chapters[1]!.title).toBe('Forest Clearing');
  });

  it('handles an empty scene', () => {
    expect(buildChapters(scene([]))).toEqual([]);
  });
});

describe('estimateAudioBytes (F1668)', () => {
  it('scales with duration and differs by format', () => {
    expect(estimateAudioBytes(0, 'opus')).toBe(0);
    const wav = estimateAudioBytes(10_000, 'wav');
    const opus = estimateAudioBytes(10_000, 'opus');
    expect(wav).toBeGreaterThan(opus); // PCM is far larger than compressed
    expect(opus).toBe(Math.round((10 * 24_000) / 8));
  });
});

describe('buildAudiobookManifest + toCueSheet (F1661/F1663)', () => {
  it('assembles metadata, chapters, total, and size estimate', () => {
    const s = scene([item('one', 1000), item('two', 1000)]);
    const manifest = buildAudiobookManifest(s, { title: 'My Fable', author: 'Rob' }, 'm4b');
    expect(manifest.totalMs).toBe(2000);
    expect(manifest.chapters).toHaveLength(2);
    expect(manifest.estimatedBytes).toBeGreaterThan(0);

    const cue = toCueSheet(manifest);
    expect(cue).toContain('TITLE "My Fable"');
    expect(cue).toContain('PERFORMER "Rob"');
    expect(cue).toContain('TRACK 01 AUDIO');
    expect(cue).toContain('INDEX 01 00:00:00');
    expect(cue).toContain('INDEX 01 00:01:00'); // second chapter at 1s
  });
});
