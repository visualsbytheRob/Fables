/**
 * Ink stroke math: simplification, smoothing, serialization (F1531, F1533, F1538).
 *
 * All functions are pure and dependency-free. A stroke is an ordered list of
 * InkPoints. Optional pressure values (0–1) are carried through every transform.
 *
 * Serialization format (compact delta encoding):
 *   "<ax>,<ay>[,<ap>]|<dx1>,<dy1>[,<dp1>]|..."
 *   - First segment: absolute x, y and optional pressure (all integers after rounding).
 *   - Remaining segments: integer deltas from the previous point.
 *   - Pressure is omitted when absent on a point.
 *   - Segments separated by "|", fields within a segment by ",".
 *   Example with pressure:  "10,20,80|3,-1,5|0,2"
 *   Example without:        "10,20|3,-1|0,2"
 */

export interface InkPoint {
  x: number;
  y: number;
  pressure?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Squared perpendicular distance from point P to segment AB. */
function perpendicularDistSq(p: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  // Project p onto the line through a and b, clamp to segment.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const ex = p.x - projX;
  const ey = p.y - projY;
  return ex * ex + ey * ey;
}

/** RDP on a subarray [start, end] (inclusive), pushing kept indices into `out`. */
function rdp(
  points: InkPoint[],
  start: number,
  end: number,
  epsilonSq: number,
  out: number[],
): void {
  if (end <= start + 1) return;

  const a = points[start]!;
  const b = points[end]!;

  let maxDistSq = 0;
  let maxIdx = start;

  for (let i = start + 1; i < end; i++) {
    const d = perpendicularDistSq(points[i]!, a, b);
    if (d > maxDistSq) {
      maxDistSq = d;
      maxIdx = i;
    }
  }

  if (maxDistSq > epsilonSq) {
    rdp(points, start, maxIdx, epsilonSq, out);
    out.push(maxIdx);
    rdp(points, maxIdx, end, epsilonSq, out);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ramer–Douglas–Peucker stroke simplification (F1531).
 *
 * Retains endpoints and any point whose perpendicular distance to the
 * current segment exceeds `epsilon`. A straight line of N points reduces
 * to exactly 2 points.
 */
export function simplifyStroke(points: InkPoint[], epsilon = 1): InkPoint[] {
  if (points.length <= 2) return points.slice();
  const epsilonSq = epsilon * epsilon;
  const indices: number[] = [0];
  rdp(points, 0, points.length - 1, epsilonSq, indices);
  indices.push(points.length - 1);
  // indices are gathered in order from rdp recursion; sort to be safe.
  indices.sort((a, b) => a - b);
  return indices.map((i) => points[i]!);
}

/**
 * Chaikin moving-average smoothing (F1533).
 *
 * Each iteration inserts two points per segment (at 1/4 and 3/4), keeping
 * the first and last points fixed. Never produces NaN.
 */
export function smoothStroke(points: InkPoint[], iterations = 1): InkPoint[] {
  if (points.length <= 2) return points.slice();

  let pts = points.slice();
  for (let iter = 0; iter < iterations; iter++) {
    const next: InkPoint[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i]!;
      const p1 = pts[i + 1]!;
      const q: InkPoint = {
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
        ...(p0.pressure !== undefined || p1.pressure !== undefined
          ? { pressure: 0.75 * (p0.pressure ?? 1) + 0.25 * (p1.pressure ?? 1) }
          : {}),
      };
      const r: InkPoint = {
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
        ...(p0.pressure !== undefined || p1.pressure !== undefined
          ? { pressure: 0.25 * (p0.pressure ?? 1) + 0.75 * (p1.pressure ?? 1) }
          : {}),
      };
      next.push(q, r);
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts;
}

/**
 * Total polyline length of a stroke (F1531).
 */
export function strokeLength(points: InkPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

/**
 * Serialize a stroke to a compact delta-encoded string (F1538).
 *
 * Format: "<ax>,<ay>[,<ap>]|<dx1>,<dy1>[,<dp1>]|..."
 * Coordinates are integer-rounded; pressure is scaled to 0–100 and rounded.
 */
export function serializeStroke(points: InkPoint[]): string {
  if (points.length === 0) return '';
  const parts: string[] = [];
  let prevX = 0;
  let prevY = 0;
  let prevP = 0;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    const rx = Math.round(pt.x);
    const ry = Math.round(pt.y);
    const hasPressure = pt.pressure !== undefined;
    const rp = hasPressure ? Math.round(pt.pressure! * 100) : 0;

    if (i === 0) {
      parts.push(hasPressure ? `${rx},${ry},${rp}` : `${rx},${ry}`);
    } else {
      const dx = rx - prevX;
      const dy = ry - prevY;
      if (hasPressure) {
        const dp = rp - prevP;
        parts.push(`${dx},${dy},${dp}`);
      } else {
        parts.push(`${dx},${dy}`);
      }
    }

    prevX = rx;
    prevY = ry;
    prevP = rp;
  }

  return parts.join('|');
}

/**
 * Deserialize a stroke from the compact delta-encoded string (F1538).
 * Exact inverse of `serializeStroke` (round-trip equal after coordinate rounding).
 */
export function deserializeStroke(s: string): InkPoint[] {
  if (s === '') return [];
  const segments = s.split('|');
  const result: InkPoint[] = [];
  let curX = 0;
  let curY = 0;
  let curP = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const fields = seg.split(',');
    const hasPressure = fields.length >= 3;

    if (i === 0) {
      curX = parseInt(fields[0]!, 10);
      curY = parseInt(fields[1]!, 10);
      curP = hasPressure ? parseInt(fields[2]!, 10) : 0;
    } else {
      curX += parseInt(fields[0]!, 10);
      curY += parseInt(fields[1]!, 10);
      if (hasPressure) curP += parseInt(fields[2]!, 10);
    }

    const pt: InkPoint = { x: curX, y: curY };
    if (hasPressure) {
      pt.pressure = curP / 100;
    }
    result.push(pt);
  }

  return result;
}
