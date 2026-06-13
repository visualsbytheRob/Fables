/**
 * Pure utility: split a text string into segments using highlight offsets
 * returned by the server (F712). Used by SearchResultItem.
 */
import type { SearchHighlight } from '../api/client.js';

export interface TextSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Split `text` into alternating plain/highlighted segments based on the
 * byte-offset ranges in `highlights`.
 */
export function splitHighlights(text: string, highlights: SearchHighlight[]): TextSegment[] {
  if (!highlights || highlights.length === 0) return [{ text, highlighted: false }];

  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const segments: TextSegment[] = [];
  let pos = 0;

  for (const { start, end } of sorted) {
    const s = Math.max(0, Math.min(start, text.length));
    const e = Math.max(s, Math.min(end, text.length));
    if (s > pos) segments.push({ text: text.slice(pos, s), highlighted: false });
    if (e > s) segments.push({ text: text.slice(s, e), highlighted: true });
    pos = e;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), highlighted: false });
  return segments;
}
