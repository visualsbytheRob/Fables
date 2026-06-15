/**
 * Design-system core tests (Epic 21, F2001–F2022 pure cores).
 */

import { describe, expect, it } from 'vitest';
import {
  contrastLevel,
  contrastRatio,
  hexToRgb,
  inGamut,
  oklchToHex,
  readableText,
  relativeLuminance,
} from './color.js';
import { accentRamp, auditRoles, seedToSystem, tonalRamp } from './palette.js';
import { lineHeightFor, scaleStep, snapToGrid, typeScale } from './typography.js';
import {
  isSettled,
  motionBudget,
  resolveMotionLevel,
  springKeyframes,
  stepSpring,
} from './motion.js';

describe('OKLCH colour core (F2001)', () => {
  it('round-trips known anchors to plausible sRGB', () => {
    // Pure black and white.
    expect(oklchToHex({ l: 0, c: 0, h: 0 })).toBe('#000000');
    expect(oklchToHex({ l: 1, c: 0, h: 0 })).toBe('#ffffff');
  });

  it('computes WCAG contrast correctly for black/white (21:1)', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff'))).toBe(21);
    expect(contrastLevel(contrastRatio('#000000', '#ffffff'))).toBe('AAA');
  });

  it('relative luminance is ordered black < grey < white', () => {
    expect(relativeLuminance('#000000')).toBeLessThan(relativeLuminance('#808080'));
    expect(relativeLuminance('#808080')).toBeLessThan(relativeLuminance('#ffffff'));
  });

  it('picks a readable text colour for a background', () => {
    expect(readableText('#ffffff')).toBe('#000000');
    expect(readableText('#000000')).toBe('#ffffff');
  });

  it('detects out-of-gamut OKLCH (extreme chroma)', () => {
    expect(inGamut({ l: 0.5, c: 0, h: 0 })).toBe(true);
    expect(inGamut({ l: 0.5, c: 0.5, h: 0 })).toBe(false);
  });

  it('parses shorthand and full hex', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#0a0b0c')).toEqual({ r: 10, g: 11, b: 12 });
  });
});

describe('seed-to-system theming (F2002–F2004)', () => {
  it('generates a 13-tone ramp from a seed', () => {
    const ramp = tonalRamp('#3b82f6');
    expect(ramp[0]).toBe('#000000');
    expect(ramp[100]).toBe('#ffffff');
    // Ascending tone → ascending luminance.
    expect(relativeLuminance(ramp[20])).toBeLessThan(relativeLuminance(ramp[80]));
  });

  it('builds a light/dark/dim triad with legible text (F2002/F2003)', () => {
    const system = seedToSystem('#3b82f6');
    for (const mode of [system.light, system.dark, system.dim]) {
      const textCheck = auditRoles(mode).find((c) => c.pair === 'text/surface');
      expect(textCheck?.passesAA).toBe(true);
    }
  });

  it('derives a per-notebook accent ramp from any seed (F2004)', () => {
    const ramp = accentRamp('#ef4444');
    expect(Object.keys(ramp)).toHaveLength(13);
  });
});

describe('type scale + rhythm (F2005–F2006)', () => {
  it('steps by the perfect-fourth ratio', () => {
    expect(scaleStep(0)).toBe(16);
    expect(scaleStep(1)).toBeCloseTo(21.33, 1);
    expect(scaleStep(-1)).toBeCloseTo(12, 0);
  });

  it('snaps line heights to the baseline grid', () => {
    expect(snapToGrid(17, 4)).toBe(20);
    expect(lineHeightFor(16, 4) % 4).toBe(0);
    expect(lineHeightFor(16, 4)).toBeGreaterThanOrEqual(16 * 1.2);
  });

  it('builds a contiguous scale with grid-aligned line heights', () => {
    const scale = typeScale(-1, 3);
    expect(scale).toHaveLength(5);
    expect(scale.every((s) => s.lineHeight % 4 === 0)).toBe(true);
  });
});

describe('spring physics + motion policy (F2009/F2022)', () => {
  it('a spring converges to its target and settles', () => {
    let state = { value: 0, velocity: 0 };
    for (let i = 0; i < 600; i += 1) state = stepSpring(state, 1, 1 / 60);
    expect(state.value).toBeCloseTo(1, 2);
    expect(isSettled(state, 1)).toBe(true);
  });

  it('keyframes start at the source and end exactly at the target', () => {
    const frames = springKeyframes(0, 100);
    expect(frames[0]).toBe(0);
    expect(frames[frames.length - 1]).toBe(100);
    expect(frames.length).toBeGreaterThan(2);
  });

  it('prefers-reduced-motion forces no motion (F2022)', () => {
    expect(resolveMotionLevel({ prefersReducedMotion: true })).toBe('none');
    expect(motionBudget({ prefersReducedMotion: true }).durationScale).toBe(0);
  });

  it('eco mode caps at reduced and disables shaders', () => {
    expect(resolveMotionLevel({ ecoMode: true })).toBe('reduced');
    const budget = motionBudget({ ecoMode: true });
    expect(budget.shaders).toBe(false);
    expect(budget.parallax).toBe(false);
  });

  it('full motion enables shaders and parallax', () => {
    const budget = motionBudget({});
    expect(budget.level).toBe('full');
    expect(budget.shaders).toBe(true);
    expect(budget.parallax).toBe(true);
  });
});
