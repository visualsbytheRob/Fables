/**
 * Pre-render pipeline tests (F1624 baking, F1629 realtime ratio).
 */

import { describe, expect, it } from 'vitest';
import { prerenderScene, realtimeRatio, type LineSynth } from './prerender.js';
import { buildWav, parseWav, wavDurationMs, type WavFormat } from './wav.js';
import type { AudioScene, SceneItem } from './scene.js';
import type { SynthesisResult } from '../tts/adapter.js';

const FMT: WavFormat = { sampleRate: 8000, channels: 1, bitsPerSample: 16 };

/** A synth that returns a clip whose length is proportional to the text. */
const synth: LineSynth = async (req): Promise<SynthesisResult> => {
  const frames = req.text.length * 80; // 10ms of audio per char @ 8kHz
  return {
    audio: buildWav({ ...FMT, data: new Uint8Array(frames * 2) }),
    format: 'wav',
    sampleRate: FMT.sampleRate,
    voiceId: req.voiceId ?? 'v',
  };
};

function line(text: string, voiced = true): SceneItem {
  return {
    kind: 'line',
    knot: 'k',
    text,
    speaker: null,
    voice: voiced ? { voiceId: 'v' } : null,
    estDurationMs: 500,
  };
}

function scene(items: SceneItem[]): AudioScene {
  return { items, totalEstMs: items.reduce((n, i) => n + i.estDurationMs, 0) };
}

describe('prerenderScene (F1624)', () => {
  it('bakes spoken lines into one WAV with per-item offsets', async () => {
    const s = scene([line('aaaa'), line('bb')]);
    const result = await prerenderScene(s, synth);
    expect(result.format).toBe('wav');
    expect(result.offsets).toHaveLength(2);
    expect(result.offsets[0]!.startMs).toBe(0);
    // Offsets are contiguous.
    expect(result.offsets[1]!.startMs).toBe(result.offsets[0]!.endMs);
    // Duration equals the sum of clip durations.
    expect(result.durationMs).toBe(result.offsets[1]!.endMs);
    expect(parseWav(result.audio).sampleRate).toBe(8000);
  });

  it('renders earcons and voiceless items as silence of their estimated length', async () => {
    const earcon: SceneItem = {
      kind: 'earcon',
      knot: 'k',
      text: '',
      speaker: null,
      voice: null,
      estDurationMs: 400,
      earcon: 'choice-prompt',
    };
    const s = scene([earcon, line('hi', false)]);
    const result = await prerenderScene(s, synth);
    // No real synthesis happened; everything is silence.
    expect(result.synthesisMs).toBe(0);
    expect(result.durationMs).toBe(wavDurationMs(result.audio));
    expect(result.offsets).toHaveLength(2);
  });

  it('falls back to silence when the synth returns null', async () => {
    const s = scene([line('hello')]);
    const result = await prerenderScene(s, async () => null);
    expect(result.durationMs).toBeGreaterThan(0); // estimated silence
  });
});

describe('realtimeRatio (F1629)', () => {
  it('is Infinity for an all-silence scene', async () => {
    const s = scene([line('x', false)]);
    const result = await prerenderScene(s, synth);
    expect(realtimeRatio(result)).toBe(Infinity);
  });

  it('is positive for a synthesised scene', async () => {
    const s = scene([line('some narration text here')]);
    const result = await prerenderScene(s, synth);
    expect(realtimeRatio(result)).toBeGreaterThan(0);
  });
});
