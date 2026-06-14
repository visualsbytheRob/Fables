/**
 * Canvas geometry: snapping & alignment guides (F1505).
 *
 * When you drag an object, it should click into alignment with its neighbours and
 * a background grid — the small touch that makes a canvas feel crafted rather than
 * loose. Pure math: given a moving box and the boxes around it, return a corrected
 * position plus the guide lines to render.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Guide {
  axis: 'x' | 'y';
  /** The coordinate of the guide line (x for vertical guides, y for horizontal). */
  at: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: Guide[];
}

export interface SnapOptions {
  /** Snap distance in canvas units (default 6). */
  threshold?: number;
  /** Grid size for background snapping; 0 disables grid snap (default 0). */
  grid?: number;
}

/** Candidate alignment lines a rectangle exposes on an axis: near / center / far edge. */
function linesX(r: Rect): number[] {
  return [r.x, r.x + r.width / 2, r.x + r.width];
}
function linesY(r: Rect): number[] {
  return [r.y, r.y + r.height / 2, r.y + r.height];
}

/**
 * Snap `moving` against the `others` and an optional grid (F1505). Returns the
 * adjusted top-left position and the guide lines that fired. Edges, centers, grid
 * — nearest wins per axis, within the threshold.
 */
export function snap(moving: Rect, others: Rect[], opts: SnapOptions = {}): SnapResult {
  const threshold = opts.threshold ?? 6;
  const grid = opts.grid ?? 0;
  const guides: Guide[] = [];

  const movingX = linesX(moving); // [left, centerX, right]
  const movingY = linesY(moving); // [top, centerY, bottom]

  const targetsX = others.flatMap(linesX);
  const targetsY = others.flatMap(linesY);
  if (grid > 0) {
    targetsX.push(Math.round(moving.x / grid) * grid);
    targetsY.push(Math.round(moving.y / grid) * grid);
  }

  const adjust = (movingLines: number[], targets: number[], axis: 'x' | 'y'): number => {
    let best: { delta: number; at: number } | null = null;
    for (const [i, line] of movingLines.entries()) {
      for (const t of targets) {
        const delta = t - line;
        if (
          Math.abs(delta) <= threshold &&
          (best === null || Math.abs(delta) < Math.abs(best.delta))
        ) {
          best = { delta, at: t };
          void i;
        }
      }
    }
    if (best === null) return 0;
    guides.push({ axis, at: best.at });
    return best.delta;
  };

  const dx = adjust(movingX, targetsX, 'x');
  const dy = adjust(movingY, targetsY, 'y');

  return { x: moving.x + dx, y: moving.y + dy, guides };
}
