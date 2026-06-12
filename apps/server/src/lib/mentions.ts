import { codeRanges, parseWikilinks, type TextRange } from '@fables/core';

/**
 * Unlinked mention detection (F221, F226, F227, F229).
 *
 * Finds candidate names (note titles today; entity aliases later — hence the
 * `{ id, names[] }` shape) appearing as plain text: case-insensitive,
 * word-boundary delimited, excluding code spans, existing wikilinks, and
 * URLs. Pure string work — the caller supplies candidates and stores hits.
 */

export interface MentionCandidate {
  id: string;
  /** Title plus any aliases; names shorter than MIN_NAME_LENGTH are ignored. */
  names: string[];
}

export interface MentionHit {
  /** Candidate (note/entity) id the text refers to. */
  id: string;
  /** The candidate name that matched (as supplied). */
  name: string;
  /** The matched text exactly as written in the body. */
  text: string;
  position: number;
  length: number;
}

/** One-character titles ("A", "I") would mention-bomb every note. */
export const MIN_NAME_LENGTH = 2;

const URL_RE = /(?:https?:\/\/|www\.)\S+/g;

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function urlRanges(body: string): TextRange[] {
  return [...body.matchAll(URL_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

const overlaps = (ranges: TextRange[], start: number, end: number): boolean =>
  ranges.some((r) => start < r.end && end > r.start);

export function detectMentions(body: string, candidates: MentionCandidate[]): MentionHit[] {
  const excluded = [
    ...codeRanges(body),
    ...parseWikilinks(body).map((l) => ({ start: l.start, end: l.end })),
    ...urlRanges(body),
  ];
  const bodyLc = body.toLowerCase();

  const hits: MentionHit[] = [];
  for (const candidate of candidates) {
    for (const name of candidate.names) {
      if (name.length < MIN_NAME_LENGTH) continue;
      const nameLc = name.toLowerCase();
      let from = 0;
      for (let at = bodyLc.indexOf(nameLc, from); at !== -1; at = bodyLc.indexOf(nameLc, from)) {
        from = at + 1;
        const end = at + nameLc.length;
        const before = body[at - 1];
        const after = body[end];
        if (before !== undefined && WORD_CHAR.test(before)) continue;
        if (after !== undefined && WORD_CHAR.test(after)) continue;
        if (overlaps(excluded, at, end)) continue;
        hits.push({
          id: candidate.id,
          name,
          text: body.slice(at, end),
          position: at,
          length: end - at,
        });
      }
    }
  }

  // Deterministic de-overlap: earliest first, longest wins on collisions.
  hits.sort((a, b) => a.position - b.position || b.length - a.length || (a.id < b.id ? -1 : 1));
  const accepted: MentionHit[] = [];
  let lastEnd = -1;
  for (const hit of hits) {
    if (hit.position < lastEnd) continue;
    accepted.push(hit);
    lastEnd = hit.position + hit.length;
  }
  return accepted;
}
