/**
 * Inline `#tag` extraction and rewriting (F152, F151, F158).
 *
 * Grammar: `#` preceded by start-of-line or a non-word boundary, followed by a
 * name of `[A-Za-z0-9_-]` segments optionally nested with `/` (e.g.
 * `#world/characters`). Names must contain at least one letter (so `#123`
 * stays an issue reference, not a tag) and are normalized to lowercase.
 * Tags inside fenced code blocks are ignored.
 */

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const TAG_RE = /(^|[^\w#/&])#([A-Za-z0-9_][A-Za-z0-9_-]*(?:\/[A-Za-z0-9_-]+)*)/g;
const TAG_NAME_RE = /^[a-z0-9_][a-z0-9_-]*(?:\/[a-z0-9_-]+)*$/;

/** Maps each line outside fenced code blocks through `fn`; fenced lines pass through untouched. */
function mapUnfencedLines(body: string, fn: (line: string) => string): string {
  let fenceChar: string | null = null;
  return body
    .split('\n')
    .map((line) => {
      const fence = FENCE_RE.exec(line);
      if (fence) {
        const char = fence[1]![0]!;
        if (fenceChar === null) fenceChar = char;
        else if (fenceChar === char) fenceChar = null;
        return line;
      }
      return fenceChar === null ? fn(line) : line;
    })
    .join('\n');
}

/** Unique, normalized (lowercase) tag names found in `body`, in order of first appearance. */
export function extractHashtags(body: string): string[] {
  const found = new Set<string>();
  mapUnfencedLines(body, (line) => {
    for (const match of line.matchAll(TAG_RE)) {
      const name = match[2]!;
      if (!/[a-z]/i.test(name)) continue;
      found.add(name.toLowerCase());
    }
    return line;
  });
  return [...found];
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Rewrites every `#from` occurrence (case-insensitive, exact name — children
 * like `#from/sub` are untouched) to `#to`, skipping fenced code blocks.
 */
export function rewriteHashtag(body: string, from: string, to: string): string {
  const re = new RegExp(`(^|[^\\w#/&])#${escapeRegExp(from)}(?![\\w/-])`, 'gi');
  return mapUnfencedLines(body, (line) => line.replace(re, (_s, pre: string) => `${pre}#${to}`));
}

/** Normalizes user-supplied tag input: trims, strips leading `#`, lowercases. */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/^#+/, '').toLowerCase();
}

/** True when `name` is a valid normalized tag name (lowercase, `/`-nested, contains a letter). */
export function isValidTagName(name: string): boolean {
  return TAG_NAME_RE.test(name) && /[a-z]/.test(name);
}
