/**
 * Lore reference extraction (F628). Scans a single Forge source buffer for the
 * fusion bindings an author embeds in prose — `[[Note Title]]` lore embeds and
 * `@entity` / `@entity.field` knowledge references — so the Lore side-pane can
 * list them and jump to where each first appears. Pure: the panel renders.
 *
 * Refs inside `//` line comments and `/* *\/` block comments are ignored so the
 * panel reflects what the *reader* will actually see, not commented-out drafts.
 */

export interface EntityRef {
  readonly name: string;
  /** The `.field` accessor, or null for a bare `@entity` display reference. */
  readonly field: string | null;
}

export interface LoreRefs {
  /** Distinct `[[Note Title]]` titles, in first-seen order. */
  readonly notes: string[];
  /** Distinct `@entity` / `@entity.field` references, in first-seen order. */
  readonly entities: EntityRef[];
  /** First byte offset of each note title / entity key (for jump-to-source). */
  readonly offsets: ReadonlyMap<string, number>;
}

/** Blank out comment spans so refs inside them are never matched. */
function stripComments(source: string): string {
  // Replace each comment with same-length spaces to preserve byte offsets.
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank);
}

const NOTE_RE = /\[\[([^\]\n]+?)\]\]/g;
// `@Name` or `@Name.field`; a name starts with a letter/underscore. Stop the
// name before a `.` so the optional field is captured separately.
const ENTITY_RE = /@([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?/g;

const entityKey = (name: string, field: string | null): string =>
  field === null ? `@${name}` : `@${name}.${field}`;

/** Extract deduped lore + entity refs with first-occurrence offsets (F628). */
export function extractLoreRefs(source: string): LoreRefs {
  const scan = stripComments(source);
  const notes: string[] = [];
  const seenNotes = new Set<string>();
  const entities: EntityRef[] = [];
  const seenEntities = new Set<string>();
  const offsets = new Map<string, number>();

  NOTE_RE.lastIndex = 0;
  for (let m = NOTE_RE.exec(scan); m !== null; m = NOTE_RE.exec(scan)) {
    const title = (m[1] as string).trim();
    if (title === '' || seenNotes.has(title)) continue;
    seenNotes.add(title);
    notes.push(title);
    offsets.set(`note:${title}`, m.index);
  }

  ENTITY_RE.lastIndex = 0;
  for (let m = ENTITY_RE.exec(scan); m !== null; m = ENTITY_RE.exec(scan)) {
    const name = m[1] as string;
    const field = m[2] ?? null;
    const key = entityKey(name, field);
    if (seenEntities.has(key)) continue;
    seenEntities.add(key);
    entities.push({ name, field });
    offsets.set(`entity:${key}`, m.index);
  }

  return { notes, entities, offsets };
}

/** Stable storage key for an entity ref, mirroring `entityKey`. */
export function entityRefKey(ref: EntityRef): string {
  return entityKey(ref.name, ref.field);
}

/** Human-readable label for an entity ref (`@Fox`, `@Crow.cunning`). */
export function entityRefLabel(ref: EntityRef): string {
  return entityRefKey(ref);
}
