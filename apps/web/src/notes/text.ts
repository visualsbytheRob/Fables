/**
 * Note text utilities: snippets for the list pane (F171), word count +
 * reading time (F193), client-side `#tag` extraction matching the server
 * grammar (F152/F153), and small formatters.
 */

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const TAG_RE = /(^|[^\w#/&])#([A-Za-z0-9_][A-Za-z0-9_-]*(?:\/[A-Za-z0-9_-]+)*)/g;

/** Unique lowercase `#tag` names in `body`, skipping fenced code blocks (server-grammar mirror). */
export function extractHashtags(body: string): string[] {
  const found = new Set<string>();
  let fenceChar: string | null = null;
  for (const line of body.split('\n')) {
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const char = fence[1]![0]!;
      if (fenceChar === null) fenceChar = char;
      else if (fenceChar === char) fenceChar = null;
      continue;
    }
    if (fenceChar !== null) continue;
    for (const match of line.matchAll(TAG_RE)) {
      const name = match[2]!;
      if (!/[a-z]/i.test(name)) continue;
      found.add(name.toLowerCase());
    }
  }
  return [...found];
}

/** First non-heading text content, markdown syntax stripped, clamped to `max` chars. */
export function snippet(body: string, max = 120): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === '' || /^#{1,6}\s/.test(line) || FENCE_RE.test(line)) continue;
    const text = line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~>]/g, '')
      .replace(/^\s*(?:[-+*]|\d+\.)\s+(?:\[[ xX]\]\s*)?/, '')
      .trim();
    if (text === '') continue;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
  return '';
}

export function wordCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return text.trim() === '' ? 0 : words.length;
}

/** Reading time in whole minutes at ~225 wpm, minimum 1 for non-empty text. */
export function readingTimeMinutes(text: string): number {
  const words = wordCount(text);
  return words === 0 ? 0 : Math.max(1, Math.round(words / 225));
}

/** Compact relative time: "now", "5m", "3h", "2d", else a date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A safe `.md` filename for exports (F195). */
export function exportFilename(title: string): string {
  const base = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return `${base || 'untitled'}.md`;
}
