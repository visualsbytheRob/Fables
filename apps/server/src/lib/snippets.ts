/**
 * Context snippet extraction for backlinks and mentions (F213).
 *
 * Takes ±`radius` characters around a match, trimmed inward to word
 * boundaries so the snippet never starts or ends mid-word, with newlines
 * flattened to spaces (offsets stay 1:1 with the slice).
 */

export interface Snippet {
  text: string;
  /** Offset of the match within `text`. */
  highlightStart: number;
  /** Offset just past the match within `text`. */
  highlightEnd: number;
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

export const SNIPPET_RADIUS = 80;

const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);

export function contextSnippet(
  body: string,
  position: number,
  length: number,
  radius: number = SNIPPET_RADIUS,
): Snippet {
  const matchStart = Math.max(0, Math.min(position, body.length));
  const matchEnd = Math.max(matchStart, Math.min(position + length, body.length));

  let start = Math.max(0, matchStart - radius);
  let end = Math.min(body.length, matchEnd + radius);

  // Trim a leading partial word: advance to the next whitespace, but never
  // into the match itself.
  if (start > 0 && !isSpace(body[start - 1]) && !isSpace(body[start])) {
    while (start < matchStart && !isSpace(body[start])) start += 1;
  }
  // Trim a trailing partial word symmetrically.
  if (end < body.length && !isSpace(body[end]) && !isSpace(body[end - 1])) {
    while (end > matchEnd && !isSpace(body[end - 1])) end -= 1;
  }
  // Drop the boundary whitespace itself.
  while (start < matchStart && isSpace(body[start])) start += 1;
  while (end > matchEnd && isSpace(body[end - 1])) end -= 1;

  return {
    text: body.slice(start, end).replace(/\n/g, ' '),
    highlightStart: matchStart - start,
    highlightEnd: matchEnd - start,
    truncatedStart: start > 0,
    truncatedEnd: end < body.length,
  };
}
