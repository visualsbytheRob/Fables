/**
 * Simple list windowing (F172): fixed row height, spacer divs above and
 * below the rendered slice. No dependencies — the math lives here so it can
 * be tested without DOM.
 */

export interface WindowSlice {
  /** Index of the first rendered row (inclusive). */
  start: number;
  /** Index just past the last rendered row (exclusive). */
  end: number;
  /** Height of the spacer above the slice, px. */
  padTop: number;
  /** Height of the spacer below the slice, px. */
  padBottom: number;
}

export function computeWindow(opts: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  count: number;
  overscan?: number;
}): WindowSlice {
  const { scrollTop, viewportHeight, rowHeight, count } = opts;
  const overscan = opts.overscan ?? 5;
  if (count === 0 || rowHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: (count - end) * rowHeight,
  };
}
