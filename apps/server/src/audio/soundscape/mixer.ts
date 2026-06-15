/**
 * Audio mixing model (Epic 17, F1638).
 *
 * Pure level math for the narration / ambient / effects buses plus a master.
 * The Web Audio player (web layer) applies these gains to its GainNodes; the
 * server owns the model so levels persist per vault and drive both live playback
 * and pre-rendered exports consistently.
 */

export interface MixLevels {
  /** Narration (TTS / recorded voice) bus gain, 0–1. */
  narration: number;
  /** Ambient soundscape bus gain, 0–1. */
  ambient: number;
  /** One-shot effects bus gain, 0–1. */
  effects: number;
  /** Master gain applied on top of every bus, 0–1. */
  master: number;
}

export const DEFAULT_MIX: MixLevels = {
  narration: 1,
  ambient: 0.4,
  effects: 0.7,
  master: 1,
};

export type MixBus = 'narration' | 'ambient' | 'effects';

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Clamp every level into [0, 1]. */
export function normalizeMix(levels: {
  [K in keyof MixLevels]?: MixLevels[K] | undefined;
}): MixLevels {
  return {
    narration: clamp01(levels.narration ?? DEFAULT_MIX.narration),
    ambient: clamp01(levels.ambient ?? DEFAULT_MIX.ambient),
    effects: clamp01(levels.effects ?? DEFAULT_MIX.effects),
    master: clamp01(levels.master ?? DEFAULT_MIX.master),
  };
}

/** Effective gain for a bus: bus level × master (F1638). */
export function busGain(levels: MixLevels, bus: MixBus): number {
  return clamp01(levels[bus] * levels.master);
}

/**
 * Ducking (F1633 model): the ambient gain to use while narration is playing —
 * ambient is attenuated by `amount` (0 = no duck, 1 = full duck) so speech stays
 * intelligible. Returns the post-duck ambient bus gain.
 */
export function duckedAmbient(levels: MixLevels, amount: number): number {
  const a = clamp01(amount);
  return clamp01(busGain(levels, 'ambient') * (1 - a));
}
