/**
 * Note chunking strategy (F723): heading-aware chunks with overlap.
 *
 * Strategy:
 *   1. Split body on heading lines (## / ### / etc.).
 *   2. If a chunk exceeds MAX_CHARS, further split on paragraphs.
 *   3. Overlap: carry the last OVERLAP_CHARS characters of the previous chunk
 *      into the start of the next (preserves context across boundaries).
 *   4. Title is always prepended to the first chunk of the note.
 *
 * Deterministic: given the same title+body, produces the same chunk list.
 */

export interface Chunk {
  /** Stable hash of (noteId + chunkIndex + content) — used as DB key. */
  hash: string;
  /** Parent note/entity/scene ID. */
  sourceId: string;
  /** Type of the source. */
  sourceType: 'note' | 'entity' | 'scene';
  /** 0-based index within this source's chunks. */
  index: number;
  /** The text content that will be embedded. */
  text: string;
  /** Heading that introduced this section (empty string for the preamble). */
  heading: string;
}

const MAX_CHARS = 512;
const OVERLAP_CHARS = 64;

/** FNV-1a 32-bit for chunk hashing (fast, no crypto dep needed here). */
function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

/** 8-char hex hash of a string. Collision rate irrelevant at vault scale. */
export function chunkHash(content: string): string {
  const h = fnv1a32(content);
  return h.toString(16).padStart(8, '0');
}

/** Split text into ≤MAX_CHARS pieces on paragraph or word boundaries, with overlap. */
function splitWithOverlap(text: string, overlap: string): string[] {
  const full = overlap ? overlap + ' ' + text : text;
  if (full.length <= MAX_CHARS) {
    return [full.trim()];
  }

  const pieces: string[] = [];
  let current = overlap ? overlap + ' ' : '';

  // Try paragraph splits first
  const paragraphs = text.split(/\n\n+/);
  if (paragraphs.length > 1) {
    for (const para of paragraphs) {
      if ((current + para).length > MAX_CHARS && current.trim().length > 0) {
        pieces.push(current.trim());
        const prev = current.trim();
        current = prev.slice(-OVERLAP_CHARS) + ' ';
      }
      current += para + '\n\n';
    }
    if (current.trim().length > 0) pieces.push(current.trim());
    return pieces.length > 0 ? pieces : [text.trim()];
  }

  // Single paragraph: split on word boundaries
  const words = text.split(/\s+/);
  for (const word of words) {
    if ((current + word + ' ').length > MAX_CHARS && current.trim().length > 0) {
      pieces.push(current.trim());
      const prev = current.trim();
      current = prev.slice(-OVERLAP_CHARS) + ' ';
    }
    current += word + ' ';
  }
  if (current.trim().length > 0) pieces.push(current.trim());
  return pieces.length > 0 ? pieces : [text.trim()];
}

/**
 * Chunk a note body into embeddable segments.
 * The note title is prepended to the first chunk for better title retrieval.
 */
export function chunkNote(
  sourceId: string,
  title: string,
  body: string,
  sourceType: 'note' | 'entity' | 'scene' = 'note',
): Chunk[] {
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  // Split on markdown headings (##, ###, etc.)
  const sections: { heading: string; text: string }[] = [];
  const headingRe = /^(#{1,6})\s+(.+)$/m;
  const lines = body.split('\n');

  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (headingRe.test(line)) {
      if (currentLines.length > 0 || currentHeading !== '') {
        sections.push({ heading: currentHeading, text: currentLines.join('\n').trim() });
        currentLines = [];
      }
      currentHeading = line.replace(/^#+\s+/, '').trim();
    } else {
      currentLines.push(line);
    }
  }
  // Final section
  sections.push({ heading: currentHeading, text: currentLines.join('\n').trim() });

  // If body is empty, emit a single chunk with just the title
  if (sections.length === 0 || sections.every((s) => s.text === '' && s.heading === '')) {
    const text = title || '';
    const hash = chunkHash(`${sourceId}:0:${text}`);
    return [{ hash, sourceId, sourceType, index: 0, text, heading: '' }];
  }

  let prevOverlap = '';
  for (let si = 0; si < sections.length; si++) {
    const { heading, text } = sections[si]!;
    const prefix =
      si === 0 && title
        ? title + (heading ? '\n' + heading + '\n' : '\n')
        : heading
          ? heading + '\n'
          : '';
    const fullText = prefix + text;
    if (fullText.trim() === '') continue;

    const pieces = splitWithOverlap(fullText, si === 0 ? '' : prevOverlap);
    for (const piece of pieces) {
      const hash = chunkHash(`${sourceId}:${chunkIndex}:${piece}`);
      chunks.push({ hash, sourceId, sourceType, index: chunkIndex, text: piece, heading });
      chunkIndex++;
    }
    // Carry overlap forward from this section's last piece
    if (pieces.length > 0) {
      const last = pieces[pieces.length - 1]!;
      prevOverlap = last.slice(-OVERLAP_CHARS);
    }
  }

  if (chunks.length === 0) {
    const text = title || '';
    const hash = chunkHash(`${sourceId}:0:${text}`);
    chunks.push({ hash, sourceId, sourceType, index: 0, text, heading: '' });
  }

  return chunks;
}
