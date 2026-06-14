/**
 * Edge routing: orthogonal and curved connectors between two rectangles (F1522).
 *
 * Connectors visually link two canvas nodes. Given a source and target
 * rectangle, these functions choose the best exit/entry sides, compute
 * axis-aligned waypoints for a right-angle connector, and compute a
 * smooth cubic Bézier for a curved connector.
 *
 * All functions are pure and dependency-free.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Center of a rectangle. */
function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mid-point of the given side of a rectangle (F1522).
 */
export function anchorPoint(rect: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }
}

/**
 * Choose the best facing sides for a connector from `a` to `b` based on
 * the relative position of their centers (F1522).
 *
 * Rules (dominant axis wins):
 *   - b is to the right of a  → from:'right', to:'left'
 *   - b is to the left of a   → from:'left',  to:'right'
 *   - b is below a            → from:'bottom', to:'top'
 *   - b is above a            → from:'top',    to:'bottom'
 * When centers coincide on both axes, default to right/left.
 */
export function bestSides(a: Rect, b: Rect): { from: Side; to: Side } {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x; // positive → b is to the right
  const dy = cb.y - ca.y; // positive → b is below

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Dominant axis: horizontal
    if (dx >= 0) return { from: 'right', to: 'left' };
    return { from: 'left', to: 'right' };
  } else {
    // Dominant axis: vertical
    if (dy >= 0) return { from: 'bottom', to: 'top' };
    return { from: 'top', to: 'bottom' };
  }
}

/**
 * Compute waypoints for an orthogonal (L/Z-shaped) connector between `a` and `b`
 * (F1522).
 *
 * Returns 4 points: anchor on a, one or two intermediate waypoints, anchor on b —
 * with every consecutive pair of points sharing an x or y coordinate (axis-aligned).
 *
 * Strategy: connect the two anchors with an L-shape (midpoint axis between them).
 */
export function orthogonalRoute(a: Rect, b: Rect): Point[] {
  const { from, to } = bestSides(a, b);
  const p0 = anchorPoint(a, from);
  const p3 = anchorPoint(b, to);

  // Determine the midpoint for the elbow based on which axis the connector exits.
  let p1: Point;
  let p2: Point;

  if (from === 'right' || from === 'left') {
    // Exit horizontally, enter vertically: elbow at x-midpoint.
    const midX = (p0.x + p3.x) / 2;
    p1 = { x: midX, y: p0.y };
    p2 = { x: midX, y: p3.y };
  } else {
    // Exit vertically, enter horizontally: elbow at y-midpoint.
    const midY = (p0.y + p3.y) / 2;
    p1 = { x: p0.x, y: midY };
    p2 = { x: p3.x, y: midY };
  }

  // If p1 === p0 or p2 === p3 (anchors already share an axis), collapse.
  const points: Point[] = [p0];
  if (p1.x !== p0.x || p1.y !== p0.y) points.push(p1);
  if ((p2.x !== p1.x || p2.y !== p1.y) && (p2.x !== p3.x || p2.y !== p3.y)) {
    points.push(p2);
  }
  points.push(p3);

  return points;
}

/**
 * Compute a smooth cubic Bézier connector between `a` and `b` (F1522).
 *
 * Returns { start, c1, c2, end } where start and end are the anchor points
 * and c1/c2 are control points pushed outward from the anchor sides to create
 * a natural S-curve.
 */
export function curvedRoute(a: Rect, b: Rect): { start: Point; c1: Point; c2: Point; end: Point } {
  const { from, to } = bestSides(a, b);
  const start = anchorPoint(a, from);
  const end = anchorPoint(b, to);

  // Push control points outward from each anchor by a fraction of the distance.
  const dist = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
  const offset = Math.max(dist * 0.4, 20);

  const outwardDelta = (side: Side): { ox: number; oy: number } => {
    switch (side) {
      case 'right':
        return { ox: offset, oy: 0 };
      case 'left':
        return { ox: -offset, oy: 0 };
      case 'bottom':
        return { ox: 0, oy: offset };
      case 'top':
        return { ox: 0, oy: -offset };
    }
  };

  const d1 = outwardDelta(from);
  const d2 = outwardDelta(to);

  const c1: Point = { x: start.x + d1.ox, y: start.y + d1.oy };
  const c2: Point = { x: end.x + d2.ox, y: end.y + d2.oy };

  return { start, c1, c2, end };
}
