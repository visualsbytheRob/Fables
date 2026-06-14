import { describe, it, expect } from 'vitest';
import {
  simplifyStroke,
  smoothStroke,
  strokeLength,
  serializeStroke,
  deserializeStroke,
} from './ink.js';
import type { InkPoint } from './ink.js';

// ---------------------------------------------------------------------------
// simplifyStroke — Ramer–Douglas–Peucker
// ---------------------------------------------------------------------------

describe('simplifyStroke', () => {
  it('returns a copy unchanged for 0 or 1 points', () => {
    expect(simplifyStroke([])).toEqual([]);
    const single: InkPoint[] = [{ x: 5, y: 5 }];
    expect(simplifyStroke(single)).toEqual(single);
  });

  it('reduces a perfectly straight horizontal line to 2 points', () => {
    const line: InkPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 40, y: 0 },
    ];
    const result = simplifyStroke(line, 1);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 40, y: 0 });
  });

  it('reduces a diagonal line to 2 points', () => {
    const line: InkPoint[] = Array.from({ length: 10 }, (_, i) => ({ x: i * 5, y: i * 5 }));
    const result = simplifyStroke(line, 1);
    expect(result).toHaveLength(2);
  });

  it('keeps a sharp corner', () => {
    // L-shape: horizontal then vertical — the corner point must be kept
    const pts: InkPoint[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 }, // corner
      { x: 10, y: 10 },
    ];
    const result = simplifyStroke(pts, 0.5);
    // Must keep start, the corner bend, and end
    expect(result.length).toBeGreaterThanOrEqual(3);
    const xs = result.map((p) => p.x);
    const ys = result.map((p) => p.y);
    // The corner (10, 0) must appear
    const hasCorner = result.some((p) => p.x === 10 && p.y === 0);
    expect(hasCorner).toBe(true);
    // Endpoints preserved
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 10, y: 10 });
    void xs;
    void ys;
  });

  it('preserves all points when they are far from the line', () => {
    const pts: InkPoint[] = [
      { x: 0, y: 0 },
      { x: 5, y: 100 },
      { x: 10, y: 0 },
    ];
    const result = simplifyStroke(pts, 1);
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// smoothStroke — Chaikin
// ---------------------------------------------------------------------------

describe('smoothStroke', () => {
  it('preserves endpoints after smoothing', () => {
    const pts: InkPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
      { x: 30, y: 5 },
    ];
    const result = smoothStroke(pts, 3);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('does not produce NaN coordinates', () => {
    const pts: InkPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ];
    const result = smoothStroke(pts, 5);
    for (const p of result) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('returns unchanged for 0 iterations', () => {
    const pts: InkPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const result = smoothStroke(pts, 0);
    expect(result).toEqual(pts);
  });

  it('preserves pressure range when all points have pressure', () => {
    const pts: InkPoint[] = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 5, pressure: 0.8 },
      { x: 20, y: 0, pressure: 0.3 },
    ];
    const result = smoothStroke(pts, 2);
    for (const p of result) {
      if (p.pressure !== undefined) {
        expect(p.pressure).toBeGreaterThanOrEqual(0);
        expect(p.pressure).toBeLessThanOrEqual(1);
      }
    }
  });

  it('returns copy unchanged for <=2 points', () => {
    const pts: InkPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    const result = smoothStroke(pts, 3);
    expect(result).toEqual(pts);
  });
});

// ---------------------------------------------------------------------------
// strokeLength
// ---------------------------------------------------------------------------

describe('strokeLength', () => {
  it('returns 0 for empty or single-point stroke', () => {
    expect(strokeLength([])).toBe(0);
    expect(strokeLength([{ x: 5, y: 5 }])).toBe(0);
  });

  it('computes length of a unit square path (perimeter = 4)', () => {
    const square: InkPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
    ];
    expect(strokeLength(square)).toBeCloseTo(4, 10);
  });

  it('measures a right-angle path correctly', () => {
    const pts: InkPoint[] = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    expect(strokeLength(pts)).toBeCloseTo(7, 10);
  });
});

// ---------------------------------------------------------------------------
// serializeStroke / deserializeStroke round-trip
// ---------------------------------------------------------------------------

describe('serialize/deserialize stroke', () => {
  it('round-trips a simple stroke without pressure', () => {
    const pts: InkPoint[] = [
      { x: 10, y: 20 },
      { x: 13, y: 19 },
      { x: 13, y: 21 },
    ];
    const s = serializeStroke(pts);
    const back = deserializeStroke(s);
    expect(back).toEqual(pts);
  });

  it('round-trips a stroke with pressure', () => {
    const pts: InkPoint[] = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 10, pressure: 0.8 },
      { x: 20, y: 5, pressure: 0.3 },
    ];
    const s = serializeStroke(pts);
    const back = deserializeStroke(s);
    expect(back).toHaveLength(pts.length);
    for (let i = 0; i < pts.length; i++) {
      expect(back[i]!.x).toBe(pts[i]!.x);
      expect(back[i]!.y).toBe(pts[i]!.y);
      // Pressure is scaled to int 0-100 and back, so within 0.01
      expect(back[i]!.pressure).toBeCloseTo(pts[i]!.pressure!, 1);
    }
  });

  it('returns empty string for empty stroke and round-trips it', () => {
    expect(serializeStroke([])).toBe('');
    expect(deserializeStroke('')).toEqual([]);
  });

  it('produces a compact format (no floats for integer coords)', () => {
    const pts: InkPoint[] = [
      { x: 100, y: 200 },
      { x: 103, y: 199 },
    ];
    const s = serializeStroke(pts);
    // Should not contain a decimal point
    expect(s).not.toContain('.');
    // Should be shorter than JSON
    expect(s.length).toBeLessThan(JSON.stringify(pts).length);
  });

  it('round-trips a stroke with coordinate rounding', () => {
    // Fractional coords get rounded; deserialize returns integers
    const pts: InkPoint[] = [
      { x: 10.6, y: 20.4 },
      { x: 11.4, y: 19.6 },
    ];
    const s = serializeStroke(pts);
    const back = deserializeStroke(s);
    expect(back[0]!.x).toBe(11); // Math.round(10.6)
    expect(back[0]!.y).toBe(20); // Math.round(20.4)
    expect(back[1]!.x).toBe(11); // Math.round(11.4)
    expect(back[1]!.y).toBe(20); // Math.round(19.6)
  });
});
