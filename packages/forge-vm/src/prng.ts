/**
 * Seedable PRNG (F471): mulberry32. The entire generator state is a single
 * uint32 that lives inside VM state, so saves and replays are deterministic:
 * the same seed plus the same choices always produce the same transcript.
 */

export const DEFAULT_SEED = 0x5eed_f00d;

/** Advance the state and return the next uint32 state. */
export function prngNext(state: number): number {
  return (state + 0x6d2b79f5) >>> 0;
}

/** Derive a float in [0, 1) from a (post-advance) state. */
export function prngFloat(state: number): number {
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Functional step: returns the new state and an integer in [min, max] (inclusive). */
export function prngInt(state: number, min: number, max: number): { state: number; value: number } {
  const next = prngNext(state);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const span = Math.floor(hi) - Math.ceil(lo) + 1;
  if (span <= 0) return { state: next, value: Math.ceil(lo) };
  return { state: next, value: Math.ceil(lo) + Math.floor(prngFloat(next) * span) };
}

/** Deterministic Fisher–Yates permutation of [0, n) driven by the PRNG state. */
export function prngPermutation(state: number, n: number): { state: number; order: number[] } {
  const order = Array.from({ length: n }, (_, i) => i);
  let s = state;
  for (let i = n - 1; i > 0; i--) {
    const r = prngInt(s, 0, i);
    s = r.state;
    const tmp = order[i] as number;
    order[i] = order[r.value] as number;
    order[r.value] = tmp;
  }
  return { state: s, order };
}

/** Normalize an arbitrary user seed (any number/string) to a uint32. */
export function normalizeSeed(seed: number | string | undefined): number {
  if (seed === undefined) return DEFAULT_SEED;
  if (typeof seed === 'number') return seed >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
