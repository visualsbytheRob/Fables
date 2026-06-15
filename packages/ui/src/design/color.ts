/**
 * OKLCH perceptual colour core (Epic 21, F2001).
 *
 * Colour tokens are defined in OKLCH so palettes are perceptually uniform and
 * contrast is correct by construction. This module converts OKLCH → sRGB (hex)
 * via the OKLab matrices (Björn Ottosson) and computes WCAG relative luminance
 * and contrast ratios, so a generated palette can guarantee AA/AAA pairings.
 * Pure maths — no DOM, no canvas.
 */

export interface Oklch {
  /** Perceptual lightness, 0..1. */
  l: number;
  /** Chroma, 0..~0.37. */
  c: number;
  /** Hue in degrees, 0..360. */
  h: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Linear-light sRGB → gamma-encoded sRGB (0..1). */
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Gamma-encoded sRGB (0..1) → linear-light. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Convert an OKLCH colour to linear-light RGB (may fall outside 0..1). */
function oklchToLinearRgb(color: Oklch): Rgb {
  const hr = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(hr);
  const b = color.c * Math.sin(hr);

  const l_ = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = color.l - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/** True when an OKLCH colour fits inside the sRGB gamut (no channel clipped). */
export function inGamut(color: Oklch, epsilon = 1e-4): boolean {
  const { r, g, b } = oklchToLinearRgb(color);
  const lo = -epsilon;
  const hi = 1 + epsilon;
  return r >= lo && r <= hi && g >= lo && g <= hi && b >= lo && b <= hi;
}

/** Convert OKLCH to 8-bit sRGB, clamping out-of-gamut channels. */
export function oklchToRgb(color: Oklch): Rgb {
  const lin = oklchToLinearRgb(color);
  return {
    r: Math.round(clamp01(linearToSrgb(lin.r)) * 255),
    g: Math.round(clamp01(linearToSrgb(lin.g)) * 255),
    b: Math.round(clamp01(linearToSrgb(lin.b)) * 255),
  };
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

export function rgbToHex(rgb: Rgb): string {
  return `#${hex2(rgb.r)}${hex2(rgb.g)}${hex2(rgb.b)}`;
}

export function oklchToHex(color: Oklch): string {
  return rgbToHex(oklchToRgb(color));
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace(/^#/, '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG relative luminance of an sRGB colour (hex or Rgb). */
export function relativeLuminance(color: string | Rgb): number {
  const rgb = typeof color === 'string' ? hexToRgb(color) : color;
  const r = srgbToLinear(rgb.r / 255);
  const g = srgbToLinear(rgb.g / 255);
  const b = srgbToLinear(rgb.b / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1..21). */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastLevel = 'AAA' | 'AA' | 'AA-large' | 'fail';

/** Classify a contrast ratio against WCAG 2.1 thresholds (normal text). */
export function contrastLevel(ratio: number): ContrastLevel {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-large';
  return 'fail';
}

/**
 * Pick black or white text for a background to maximise contrast — the simplest
 * always-legible foreground choice.
 */
export function readableText(background: string | Rgb): '#000000' | '#ffffff' {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#000000')
    ? '#ffffff'
    : '#000000';
}
