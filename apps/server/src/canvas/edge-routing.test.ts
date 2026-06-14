import { describe, it, expect } from 'vitest';
import { anchorPoint, bestSides, orthogonalRoute, curvedRoute } from './edge-routing.js';
import type { Rect } from './edge-routing.js';

// Helpers
const rect = (x: number, y: number, w: number, h: number): Rect => ({
  x,
  y,
  width: w,
  height: h,
});

// ---------------------------------------------------------------------------
// anchorPoint
// ---------------------------------------------------------------------------

describe('anchorPoint', () => {
  const r = rect(10, 20, 80, 60);

  it('top anchor is at horizontal midpoint, top edge', () => {
    expect(anchorPoint(r, 'top')).toEqual({ x: 50, y: 20 });
  });

  it('bottom anchor is at horizontal midpoint, bottom edge', () => {
    expect(anchorPoint(r, 'bottom')).toEqual({ x: 50, y: 80 });
  });

  it('left anchor is at vertical midpoint, left edge', () => {
    expect(anchorPoint(r, 'left')).toEqual({ x: 10, y: 50 });
  });

  it('right anchor is at vertical midpoint, right edge', () => {
    expect(anchorPoint(r, 'right')).toEqual({ x: 90, y: 50 });
  });
});

// ---------------------------------------------------------------------------
// bestSides
// ---------------------------------------------------------------------------

describe('bestSides', () => {
  it('b to the right → right/left', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(200, 0, 50, 50);
    expect(bestSides(a, b)).toEqual({ from: 'right', to: 'left' });
  });

  it('b to the left → left/right', () => {
    const a = rect(200, 0, 50, 50);
    const b = rect(0, 0, 50, 50);
    expect(bestSides(a, b)).toEqual({ from: 'left', to: 'right' });
  });

  it('b below → bottom/top', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(0, 200, 50, 50);
    expect(bestSides(a, b)).toEqual({ from: 'bottom', to: 'top' });
  });

  it('b above → top/bottom', () => {
    const a = rect(0, 200, 50, 50);
    const b = rect(0, 0, 50, 50);
    expect(bestSides(a, b)).toEqual({ from: 'top', to: 'bottom' });
  });

  it('diagonal (wider than tall) → horizontal sides', () => {
    // dx=200, dy=50 → horizontal dominant
    const a = rect(0, 0, 10, 10);
    const b = rect(200, 50, 10, 10);
    expect(bestSides(a, b)).toEqual({ from: 'right', to: 'left' });
  });

  it('diagonal (taller than wide) → vertical sides', () => {
    // dx=50, dy=200 → vertical dominant
    const a = rect(0, 0, 10, 10);
    const b = rect(50, 200, 10, 10);
    expect(bestSides(a, b)).toEqual({ from: 'bottom', to: 'top' });
  });
});

// ---------------------------------------------------------------------------
// orthogonalRoute
// ---------------------------------------------------------------------------

describe('orthogonalRoute', () => {
  it('all segments are axis-aligned (consecutive points share x or y)', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(200, 100, 50, 50);
    const pts = orthogonalRoute(a, b);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      expect(p.x === q.x || p.y === q.y).toBe(true);
    }
  });

  it('first point lies on the border of rect a', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(200, 0, 50, 50);
    const pts = orthogonalRoute(a, b);
    const start = pts[0]!;
    // Must be on one of a's edges
    const onTop = start.y === a.y;
    const onBottom = start.y === a.y + a.height;
    const onLeft = start.x === a.x;
    const onRight = start.x === a.x + a.width;
    expect(onTop || onBottom || onLeft || onRight).toBe(true);
  });

  it('last point lies on the border of rect b', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(200, 0, 50, 50);
    const pts = orthogonalRoute(a, b);
    const end = pts[pts.length - 1]!;
    const onTop = end.y === b.y;
    const onBottom = end.y === b.y + b.height;
    const onLeft = end.x === b.x;
    const onRight = end.x === b.x + b.width;
    expect(onTop || onBottom || onLeft || onRight).toBe(true);
  });

  it('routes vertically when b is directly below a', () => {
    const a = rect(100, 0, 50, 50);
    const b = rect(100, 200, 50, 50);
    const pts = orthogonalRoute(a, b);
    // All segments should be axis-aligned
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      expect(p.x === q.x || p.y === q.y).toBe(true);
    }
    // Start should be on bottom of a, end on top of b
    expect(pts[0]!.y).toBe(50); // bottom of a
    expect(pts[pts.length - 1]!.y).toBe(200); // top of b
  });
});

// ---------------------------------------------------------------------------
// curvedRoute
// ---------------------------------------------------------------------------

describe('curvedRoute', () => {
  it('start equals anchor point of a', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(200, 0, 50, 50);
    const { start, from } = { ...curvedRoute(a, b), from: bestSides(a, b).from };
    expect(start).toEqual(anchorPoint(a, from));
  });

  it('end equals anchor point of b', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(200, 0, 50, 50);
    const { end, to } = { ...curvedRoute(a, b), to: bestSides(a, b).to };
    expect(end).toEqual(anchorPoint(b, to));
  });

  it('control points are distinct from endpoints', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(200, 100, 50, 50);
    const { start, c1, c2, end } = curvedRoute(a, b);
    expect(c1).not.toEqual(start);
    expect(c2).not.toEqual(end);
  });

  it('c1 is pushed outward from a (horizontal connector → c1.x > start.x)', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(200, 0, 50, 50);
    const { start, c1 } = curvedRoute(a, b);
    // from:'right', so c1 should have greater x than start
    expect(c1.x).toBeGreaterThan(start.x);
    expect(c1.y).toBe(start.y);
  });

  it('c2 is pushed outward from b (connector enters from left → c2.x < end.x)', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(200, 0, 50, 50);
    const { end, c2 } = curvedRoute(a, b);
    // to:'left', so c2 is pushed left (negative offset)
    expect(c2.x).toBeLessThan(end.x);
    expect(c2.y).toBe(end.y);
  });

  it('works for vertical (top/bottom) arrangement', () => {
    const a = rect(0, 0, 50, 50);
    const b = rect(0, 200, 50, 50);
    const { start, c1, c2, end } = curvedRoute(a, b);
    // from:'bottom' → c1.y > start.y, to:'top' → c2.y < end.y
    expect(c1.y).toBeGreaterThan(start.y);
    expect(c2.y).toBeLessThan(end.y);
  });
});
