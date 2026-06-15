/**
 * Mixer model tests (F1638, F1633 ducking model).
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_MIX, busGain, duckedAmbient, normalizeMix } from './mixer.js';

describe('normalizeMix (F1638)', () => {
  it('clamps levels into [0,1] and fills defaults', () => {
    const m = normalizeMix({ narration: 2, ambient: -1 });
    expect(m.narration).toBe(1);
    expect(m.ambient).toBe(0);
    expect(m.effects).toBe(DEFAULT_MIX.effects);
    expect(m.master).toBe(DEFAULT_MIX.master);
  });
});

describe('busGain', () => {
  it('multiplies bus level by master', () => {
    const m = normalizeMix({ ambient: 0.5, master: 0.5 });
    expect(busGain(m, 'ambient')).toBeCloseTo(0.25);
  });
});

describe('duckedAmbient (F1633)', () => {
  it('attenuates ambient by the duck amount', () => {
    const m = normalizeMix({ ambient: 1, master: 1 });
    expect(duckedAmbient(m, 0)).toBeCloseTo(1);
    expect(duckedAmbient(m, 1)).toBeCloseTo(0);
    expect(duckedAmbient(m, 0.6)).toBeCloseTo(0.4);
  });

  it('clamps the duck amount', () => {
    const m = normalizeMix({ ambient: 1, master: 1 });
    expect(duckedAmbient(m, 5)).toBeCloseTo(0);
    expect(duckedAmbient(m, -5)).toBeCloseTo(1);
  });
});
