/**
 * Seed-to-system theming (Epic 21, F2002–F2004).
 *
 * One seed colour generates a full tonal palette in OKLCH — perceptually even
 * tone steps at a fixed hue — plus role tokens (surface/text/accent) whose
 * pairings are checked for WCAG contrast by construction. A light/dark/dim triad
 * (F2003) is three role sets over the same ramp; a per-notebook accent (F2004)
 * is the same generator seeded with a different hue. Pure maths.
 */

import {
  contrastLevel,
  contrastRatio,
  oklchToHex,
  readableText,
  type ContrastLevel,
  type Oklch,
} from './color.js';

export type Tone = 0 | 5 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 95 | 100;

export const TONES: Tone[] = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];

/** A tonal ramp: tone (0=black … 100=white) → hex, at the seed's hue/chroma. */
export type TonalRamp = Record<Tone, string>;

/** Parse a hex seed into an approximate OKLCH hue + chroma anchor. */
function seedToHueChroma(seedHex: string): { h: number; c: number } {
  // Reuse the inverse path lightly: derive hue/chroma from the seed by scanning
  // candidate OKLCH values — cheap and good enough for theming.
  // Convert hex → rough OKLCH by searching hue that best matches, fixed mid L.
  // For determinism we compute directly from the seed's RGB via OKLab.
  const clean = seedHex.replace(/^#/, '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);
  const l = Math.cbrt(0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl);
  const m = Math.cbrt(0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl);
  const s = Math.cbrt(0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return { h: (h + 360) % 360, c: Math.min(0.37, Math.hypot(a, bb)) };
}

/** Generate a perceptually even tonal ramp from a seed colour. */
export function tonalRamp(seedHex: string): TonalRamp {
  const { h, c } = seedToHueChroma(seedHex);
  const ramp = {} as TonalRamp;
  for (const tone of TONES) {
    const l = tone / 100;
    // Triangular chroma taper: full at mid-tone, exactly zero at 0/100 so the
    // extremes read as pure black/white.
    const chroma = c * (1 - Math.abs(2 * l - 1));
    const color: Oklch = { l, c: Math.max(0, chroma), h };
    ramp[tone] = oklchToHex(color);
  }
  return ramp;
}

export interface RoleColors {
  surface: string;
  surfaceVariant: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  border: string;
}

export type ThemeMode = 'light' | 'dark' | 'dim';

/** Map a tonal ramp to role tokens for a given mode (F2003 triad). */
export function rolesFor(ramp: TonalRamp, mode: ThemeMode): RoleColors {
  if (mode === 'light') {
    return {
      surface: ramp[100],
      surfaceVariant: ramp[95],
      text: ramp[10],
      textMuted: ramp[40],
      accent: ramp[40],
      accentText: readableText(ramp[40]),
      border: ramp[80],
    };
  }
  if (mode === 'dim') {
    return {
      surface: ramp[20],
      surfaceVariant: ramp[30],
      text: ramp[95],
      textMuted: ramp[70],
      accent: ramp[70],
      accentText: readableText(ramp[70]),
      border: ramp[40],
    };
  }
  // dark
  return {
    surface: ramp[5],
    surfaceVariant: ramp[10],
    text: ramp[95],
    textMuted: ramp[60],
    accent: ramp[80],
    accentText: readableText(ramp[80]),
    border: ramp[30],
  };
}

export interface PaletteCheck {
  pair: string;
  ratio: number;
  level: ContrastLevel;
  passesAA: boolean;
}

/** Audit the legibility of a role set's text-on-surface pairings (F2002). */
export function auditRoles(roles: RoleColors): PaletteCheck[] {
  const pairs: [string, string, string][] = [
    ['text/surface', roles.text, roles.surface],
    ['textMuted/surface', roles.textMuted, roles.surface],
    ['accentText/accent', roles.accentText, roles.accent],
  ];
  return pairs.map(([pair, fg, bg]) => {
    const ratio = contrastRatio(fg, bg);
    return { pair, ratio, level: contrastLevel(ratio), passesAA: ratio >= 4.5 };
  });
}

export interface SystemTheme {
  seed: string;
  ramp: TonalRamp;
  light: RoleColors;
  dark: RoleColors;
  dim: RoleColors;
}

/** Build the full light/dark/dim system from a single seed (F2002/F2003). */
export function seedToSystem(seedHex: string): SystemTheme {
  const ramp = tonalRamp(seedHex);
  return {
    seed: seedHex,
    ramp,
    light: rolesFor(ramp, 'light'),
    dark: rolesFor(ramp, 'dark'),
    dim: rolesFor(ramp, 'dim'),
  };
}

/** A per-notebook accent ramp from any seed colour (F2004). */
export function accentRamp(seedHex: string): TonalRamp {
  return tonalRamp(seedHex);
}
