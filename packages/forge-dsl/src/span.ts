/**
 * Source positions and spans. Every token, AST node, and diagnostic carries a
 * span so tooling can always point back at the exact source text.
 */

/** A single position in a source file. Lines and columns are 1-based; offset is 0-based. */
export interface Position {
  readonly line: number;
  readonly col: number;
  readonly offset: number;
}

/** A half-open region of source text: [start, end). */
export interface Span {
  readonly start: Position;
  readonly end: Position;
}

export function pos(line: number, col: number, offset: number): Position {
  return { line, col, offset };
}

export function span(start: Position, end: Position): Span {
  return { start, end };
}

/** A zero-width span at the given position (used for EOF and synthetic nodes). */
export function pointSpan(at: Position): Span {
  return { start: at, end: at };
}

/** Span covering both input spans. */
export function mergeSpans(a: Span, b: Span): Span {
  const start = a.start.offset <= b.start.offset ? a.start : b.start;
  const end = a.end.offset >= b.end.offset ? a.end : b.end;
  return { start, end };
}

/** True when `inner` lies entirely within `outer`. */
export function spanContains(outer: Span, inner: Span): boolean {
  return inner.start.offset >= outer.start.offset && inner.end.offset <= outer.end.offset;
}

/** True when the two spans overlap (share at least one offset, or touch a zero-width span). */
export function spansOverlap(a: Span, b: Span): boolean {
  return a.start.offset <= b.end.offset && b.start.offset <= a.end.offset;
}

/** Synthetic span used by node factories when no real source exists. */
export const SYNTHETIC_SPAN: Span = {
  start: { line: 0, col: 0, offset: 0 },
  end: { line: 0, col: 0, offset: 0 },
};

export function isSyntheticSpan(s: Span): boolean {
  return s.start.line === 0 && s.end.line === 0;
}

/** Precomputed line-start offsets for fast offset↔position conversion. */
export function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

/** Convert a raw offset into a Position using precomputed line starts. */
export function offsetToPosition(offset: number, lineStarts: number[]): Position {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  const lineStart = lineStarts[lo] ?? 0;
  return { line: lo + 1, col: offset - lineStart + 1, offset };
}

/** The raw text covered by a span. */
export function spanText(source: string, s: Span): string {
  return source.slice(s.start.offset, s.end.offset);
}

/** One line of a source excerpt produced by {@link spanExcerpt}. */
export interface ExcerptLine {
  readonly line: number;
  readonly text: string;
  /** 1-based column where the underline starts on this line (0 = no underline). */
  readonly underlineStart: number;
  /** Number of columns to underline (minimum 1 when underlineStart > 0). */
  readonly underlineLength: number;
}

/**
 * Extract the source lines a span covers, with per-line underline ranges.
 * This is the engine behind the pretty diagnostic renderer (F334/F343).
 */
export function spanExcerpt(source: string, s: Span, contextLines = 0): ExcerptLine[] {
  const lines = source.split('\n');
  const firstLine = Math.max(1, s.start.line - contextLines);
  const lastLine = Math.min(lines.length, Math.max(s.end.line, s.start.line) + contextLines);
  const out: ExcerptLine[] = [];
  for (let ln = firstLine; ln <= lastLine; ln++) {
    const text = lines[ln - 1] ?? '';
    let underlineStart = 0;
    let underlineLength = 0;
    if (ln >= s.start.line && ln <= s.end.line) {
      const from = ln === s.start.line ? s.start.col : 1;
      const to = ln === s.end.line ? s.end.col : text.length + 1;
      underlineStart = from;
      underlineLength = Math.max(1, to - from);
    }
    out.push({ line: ln, text, underlineStart, underlineLength });
  }
  return out;
}
