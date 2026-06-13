/**
 * Player tag conventions (F546/F547/F555–F557): pure parsing of the small
 * `# key: value` vocabulary the player understands on top of plain Forge tags.
 *
 * - `# stat: health` (header)        → bound stat chip; `# stat: health / 20`
 *                                      renders a bar with that maximum.
 * - `# scene: forest` (on a line)    → ambient backdrop until the next scene.
 * - `# chapter: One` (on a line)     → full-width chapter title card (F556).
 * - `# ending: good` (on a line)     → names the ending for the collection.
 * - `# shake` / `# whisper` / `# emphasis` → paragraph text effects (F557).
 * - `![alt](/api/v1/attachments/:id)` in prose → inline image (F547).
 */

/** A VAR-bound stat display declared in the story header (F546). */
export interface StatDef {
  readonly name: string;
  /** Bar maximum; null renders a plain numeric chip. */
  readonly max: number | null;
}

/** Parse `# stat: <var> [/ <max>]` header lines from the entry source. */
export function parseStatTags(source: string): StatDef[] {
  const defs: StatDef[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(/^#\s*stat:\s*([A-Za-z_]\w*)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*$/gm)) {
    const name = match[1];
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    const rawMax = match[2];
    defs.push({ name, max: rawMax === undefined ? null : Number(rawMax) });
  }
  return defs;
}

export const TEXT_EFFECTS = ['shake', 'whisper', 'emphasis'] as const;
export type TextEffect = (typeof TEXT_EFFECTS)[number];

export interface ClassifiedTags {
  readonly scene: string | null;
  readonly chapter: string | null;
  readonly ending: string | null;
  readonly effects: readonly TextEffect[];
}

/** Split a raw tag into key/value at the first colon. */
function splitTag(tag: string): { key: string; value: string } {
  const colon = tag.indexOf(':');
  if (colon === -1) return { key: tag.trim().toLowerCase(), value: '' };
  return { key: tag.slice(0, colon).trim().toLowerCase(), value: tag.slice(colon + 1).trim() };
}

/** Pull the player-known directives out of a transcript entry's tags. */
export function classifyTags(tags: readonly string[] | undefined): ClassifiedTags {
  let scene: string | null = null;
  let chapter: string | null = null;
  let ending: string | null = null;
  const effects: TextEffect[] = [];
  for (const tag of tags ?? []) {
    const { key, value } = splitTag(tag);
    if (key === 'scene' && value !== '') scene = value.toLowerCase();
    else if (key === 'chapter' && value !== '') chapter = value;
    else if (key === 'ending' && value !== '') ending = value;
    else if ((TEXT_EFFECTS as readonly string[]).includes(key) && !effects.includes(key as TextEffect)) {
      effects.push(key as TextEffect);
    }
  }
  return { scene, chapter, ending, effects };
}

/** A prose run or an inline image extracted from a paragraph (F547). */
export type Segment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'image'; readonly alt: string; readonly src: string }
  /** A tappable entity name surfaced by the VM host (F623 web half). */
  | { readonly kind: 'entity'; readonly name: string; readonly text: string }
  /** A tappable `[[note]]` lore link surfaced by the VM host (F621). */
  | { readonly kind: 'lore'; readonly title: string; readonly text: string };

/* ── host markers (F621/F623) ──────────────────────────────────────────────
 * The player's VM host wraps entity displays and note references in private-
 * use sentinels so the renderer can make them tappable without ever showing
 * marker characters to the reader. Authors cannot type these from a story. */

export const ENTITY_OPEN = '\uE000';
export const ENTITY_SEP = '\uE001';
export const ENTITY_CLOSE = '\uE002';
export const LORE_OPEN = '\uE003';
export const LORE_CLOSE = '\uE004';

/** Wrap an entity display for the renderer (host `resolveEntityDisplay`). */
export const markEntity = (name: string, display: string): string =>
  `${ENTITY_OPEN}${name}${ENTITY_SEP}${display}${ENTITY_CLOSE}`;

/** Wrap a note title for the renderer (host `resolveNote`). */
export const markLore = (title: string): string => `${LORE_OPEN}${title}${LORE_CLOSE}`;

const MARKER_RE = new RegExp(
  `${ENTITY_OPEN}([^${ENTITY_SEP}]*)${ENTITY_SEP}([^${ENTITY_CLOSE}]*)${ENTITY_CLOSE}` +
    `|${LORE_OPEN}([^${LORE_CLOSE}]*)${LORE_CLOSE}`,
  'g',
);

/** Replace host markers with their plain display text (transcripts, TTS, choices). */
export function stripMarkers(text: string): string {
  MARKER_RE.lastIndex = 0;
  return text.replace(MARKER_RE, (_m, _name, display, title) =>
    typeof title === 'string' ? title : (display ?? ''),
  );
}

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/** Split a marker-free prose run into text + inline-image segments (F547). */
function parseProse(text: string, segments: Segment[]): void {
  let last = 0;
  for (const match of text.matchAll(IMAGE_RE)) {
    const at = match.index;
    if (at > last) segments.push({ kind: 'text', text: text.slice(last, at) });
    segments.push({ kind: 'image', alt: match[1] ?? '', src: match[2] ?? '' });
    last = at + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
}

/** Split paragraph text into prose / image / entity / lore segments. */
export function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  MARKER_RE.lastIndex = 0;
  for (const match of text.matchAll(MARKER_RE)) {
    const at = match.index;
    if (at > last) parseProse(text.slice(last, at), segments);
    if (typeof match[3] === 'string') {
      segments.push({ kind: 'lore', title: match[3], text: match[3] });
    } else {
      segments.push({ kind: 'entity', name: match[1] ?? '', text: match[2] ?? '' });
    }
    last = at + match[0].length;
  }
  if (last < text.length) parseProse(text.slice(last), segments);
  if (segments.length === 0) segments.push({ kind: 'text', text });
  return segments;
}

/**
 * Scene → ambient backdrop hue (F555). Known scenes get a curated hue;
 * anything else hashes to a stable hue so authors can invent scenes freely.
 */
const SCENE_HUES: Readonly<Record<string, number>> = {
  forest: 140,
  wood: 140,
  meadow: 110,
  sea: 200,
  ocean: 200,
  river: 195,
  night: 250,
  cave: 270,
  dungeon: 280,
  city: 215,
  village: 45,
  desert: 35,
  fire: 15,
  battle: 0,
  winter: 190,
  snow: 190,
  dawn: 25,
  morning: 50,
  dusk: 300,
  evening: 285,
};

export function sceneHue(scene: string | null): number | null {
  if (scene === null || scene === '') return null;
  const known = SCENE_HUES[scene];
  if (known !== undefined) return known;
  let hash = 0;
  for (let i = 0; i < scene.length; i++) hash = (hash * 31 + scene.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

/** Stable slug for ending ids and cover initials. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled'
  );
}
