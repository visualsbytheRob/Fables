/**
 * Pre-render a narration scene to a single baked audio file (F1624) and a
 * faster-than-realtime perf probe (F1629).
 *
 * `prerenderScene` walks an AudioScene in order, synthesising each spoken line
 * through an injected `synth` function and splicing the clips (with silence for
 * earcons / empty items) into one WAV via the wav.ts utilities. It also returns
 * a per-item offset map so a player can seek by scene position — the actual
 * audio bridge for the read-along alignment in F1641.
 */

import type { SynthesisRequest, SynthesisResult } from '../tts/adapter.js';
import type { AudioScene, SceneItem } from './scene.js';
import { concatWav, parseWav, silence, wavDurationMs, type WavFormat } from './wav.js';

/** Synthesise one line of the scene; returns null to skip (e.g. no voice). */
export type LineSynth = (req: SynthesisRequest) => Promise<SynthesisResult | null>;

export interface PrerenderItemOffset {
  /** Index into the scene's items. */
  index: number;
  startMs: number;
  endMs: number;
}

export interface PrerenderResult {
  /** The baked WAV (canonical PCM). */
  audio: Uint8Array;
  format: 'wav';
  sampleRate: number;
  durationMs: number;
  /** Real wall-clock time spent synthesising, for the realtime ratio (F1629). */
  synthesisMs: number;
  /** Per-item time offsets in the baked file. */
  offsets: PrerenderItemOffset[];
}

const DEFAULT_FMT: WavFormat = { sampleRate: 22_050, channels: 1, bitsPerSample: 16 };

/**
 * Bake a scene to one WAV. Each line item with text + a voice is synthesised;
 * earcons and empty/voiceless items become silence of their estimated length so
 * the timeline stays faithful. The first real clip's format sets the output
 * format (engines emit one fixed format).
 */
export async function prerenderScene(
  scene: AudioScene,
  synth: LineSynth,
): Promise<PrerenderResult> {
  const clips: Uint8Array[] = [];
  const offsets: PrerenderItemOffset[] = [];
  let fmt: WavFormat | null = null;
  let cursorMs = 0;
  let synthesisMs = 0;

  const pushSilence = (item: SceneItem, ms: number): void => {
    const f = fmt ?? DEFAULT_FMT;
    const clip = silence(Math.max(0, ms), f);
    clips.push(clip);
    register(item, clip);
  };

  const register = (item: SceneItem, clip: Uint8Array): void => {
    const dur = wavDurationMs(clip);
    offsets.push({ index: scene.items.indexOf(item), startMs: cursorMs, endMs: cursorMs + dur });
    cursorMs += dur;
  };

  for (const item of scene.items) {
    const speakable = item.kind === 'line' && item.text.trim().length > 0 && item.voice !== null;
    if (!speakable) {
      pushSilence(item, item.estDurationMs);
      continue;
    }
    const voice = item.voice!;
    const t0 = performance.now();
    const result = await synth({
      text: item.text,
      voiceId: voice.voiceId,
      ...(voice.rate !== undefined ? { rate: voice.rate } : {}),
      ...(voice.pitch !== undefined ? { pitch: voice.pitch } : {}),
    });
    synthesisMs += performance.now() - t0;
    if (!result) {
      pushSilence(item, item.estDurationMs);
      continue;
    }
    if (!fmt) fmt = parseWav(result.audio);
    clips.push(result.audio);
    register(item, result.audio);
  }

  const audio = clips.length > 0 ? concatWav(clips) : silence(0, fmt ?? DEFAULT_FMT);
  const durationMs = wavDurationMs(audio);
  return {
    audio,
    format: 'wav',
    sampleRate: (fmt ?? DEFAULT_FMT).sampleRate,
    durationMs,
    synthesisMs,
    offsets,
  };
}

/**
 * Realtime ratio for a pre-render (F1629): audio seconds produced per wall-clock
 * second. > 1 means faster-than-realtime (a 10-minute fable renders in under 10
 * minutes). Returns Infinity when no time was spent (all-silence scene).
 */
export function realtimeRatio(result: PrerenderResult): number {
  if (result.synthesisMs <= 0) return Infinity;
  return result.durationMs / result.synthesisMs;
}
