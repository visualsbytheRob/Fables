/**
 * Editorial type scale + vertical rhythm (Epic 21, F2005–F2006).
 *
 * A modular type scale (perfect-fourth ramp by default) with tabular-numeral and
 * optical-size hints, plus a baseline-grid engine that snaps every measurement
 * to a 4/8pt grid and computes grid-aligned line heights. Pure maths producing
 * tokens the CSS layer consumes.
 */

/** The classic ratios; 'perfectFourth' (1.333) is the editorial default. */
export const RATIOS = {
  minorThird: 1.2,
  majorThird: 1.25,
  perfectFourth: 1.333,
  augmentedFourth: 1.414,
  perfectFifth: 1.5,
  golden: 1.618,
} as const;

export type RatioName = keyof typeof RATIOS;

export interface TypeStep {
  step: number;
  /** Font size in px, rounded to 0.01. */
  px: number;
  /** Font size in rem (relative to base). */
  rem: number;
  /** Grid-aligned line height in px. */
  lineHeight: number;
}

export interface TypeScaleOptions {
  base?: number;
  ratio?: RatioName | number;
  /** Baseline grid unit for line-height snapping. */
  grid?: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The size of step `n` (0 = base; negatives are smaller). */
export function scaleStep(step: number, opts: TypeScaleOptions = {}): number {
  const base = opts.base ?? 16;
  const ratio = typeof opts.ratio === 'number' ? opts.ratio : RATIOS[opts.ratio ?? 'perfectFourth'];
  return round2(base * Math.pow(ratio, step));
}

/** Snap a measurement up to the nearest multiple of the baseline grid (F2006). */
export function snapToGrid(value: number, grid = 4): number {
  return Math.ceil(value / grid) * grid;
}

/** A grid-aligned line height for a font size — at least 1.2×, snapped (F2006). */
export function lineHeightFor(fontSizePx: number, grid = 4, minRatio = 1.2): number {
  return snapToGrid(fontSizePx * minRatio, grid);
}

/** Build a full modular scale across a range of steps (F2005). */
export function typeScale(from: number, to: number, opts: TypeScaleOptions = {}): TypeStep[] {
  const base = opts.base ?? 16;
  const grid = opts.grid ?? 4;
  const steps: TypeStep[] = [];
  for (let step = from; step <= to; step += 1) {
    const px = scaleStep(step, opts);
    steps.push({
      step,
      px,
      rem: round2(px / base),
      lineHeight: lineHeightFor(px, grid),
    });
  }
  return steps;
}

/** Vertical-rhythm helper: how many grid units tall a block of text is. */
export function rhythmUnits(heightPx: number, grid = 4): number {
  return Math.round(snapToGrid(heightPx, grid) / grid);
}
