/**
 * Reader annotations (F636/F637): a reader can select story text and turn it
 * into a linked note. The note itself is created through the normal notes API
 * (so it lives in the knowledge base, is searchable, graphable, etc.); this
 * module keeps the lightweight per-story registry that ties each note back to
 * the exact story moment it was struck from (story id, playthrough, turn,
 * scene and the quoted text), so the annotation-review view (F637) can list
 * every annotation across playthroughs and deep-link back into the player.
 *
 * Pure + storage-injectable so the logic is unit-testable without a DOM.
 */

export interface Annotation {
  readonly id: string;
  /** The note created for this annotation (notes API). */
  readonly noteId: string;
  readonly storyId: string;
  readonly playthroughId: string;
  /** Turn the selection was made on — drives the `?turn=` deep link (F635). */
  readonly turn: number;
  /** Ambient scene at the moment, for the review list. */
  readonly scene: string;
  /** The quoted story text the reader highlighted. */
  readonly quote: string;
  readonly createdAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultStorage = (): StorageLike | null =>
  typeof localStorage === 'undefined' ? null : localStorage;

const key = (storyId: string): string => `fables.annotations.${storyId}`;

const makeId = (): string =>
  `an_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function loadAnnotations(
  storyId: string,
  store: StorageLike | null = defaultStorage(),
): Annotation[] {
  if (store === null) return [];
  try {
    const raw = store.getItem(key(storyId));
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Annotation[]) : [];
  } catch {
    return [];
  }
}

function persist(
  storyId: string,
  annotations: readonly Annotation[],
  store: StorageLike | null,
): void {
  try {
    if (annotations.length === 0) store?.removeItem(key(storyId));
    else store?.setItem(key(storyId), JSON.stringify(annotations));
  } catch {
    /* storage full — annotations are best-effort */
  }
}

export interface NewAnnotation {
  noteId: string;
  storyId: string;
  playthroughId: string;
  turn: number;
  scene: string;
  quote: string;
}

/** Record a freshly-created annotation note in the per-story registry. */
export function addAnnotation(
  input: NewAnnotation,
  store: StorageLike | null = defaultStorage(),
): Annotation {
  const annotation: Annotation = {
    id: makeId(),
    noteId: input.noteId,
    storyId: input.storyId,
    playthroughId: input.playthroughId,
    turn: input.turn,
    scene: input.scene,
    quote: input.quote,
    createdAt: new Date().toISOString(),
  };
  persist(input.storyId, [annotation, ...loadAnnotations(input.storyId, store)], store);
  return annotation;
}

export function removeAnnotation(
  storyId: string,
  id: string,
  store: StorageLike | null = defaultStorage(),
): void {
  persist(
    storyId,
    loadAnnotations(storyId, store).filter((a) => a.id !== id),
    store,
  );
}

/**
 * A first-line note title from a highlighted quote: short, single-line, and
 * clearly an annotation so it reads well in the notes list.
 */
export function annotationTitle(quote: string): string {
  const oneLine = quote.replace(/\s+/g, ' ').trim();
  const clipped = oneLine.length > 48 ? `${oneLine.slice(0, 47)}…` : oneLine;
  return clipped === '' ? 'Annotation' : `Note: “${clipped}”`;
}

/**
 * The markdown body for an annotation note: the quoted passage as a blockquote
 * plus a back-reference link to the exact story moment (F635 deep link).
 */
export function annotationBody(input: {
  storyId: string;
  storyTitle: string;
  turn: number;
  scene: string;
  quote: string;
}): string {
  const link = `/stories/${input.storyId}/play?turn=${input.turn}`;
  const sceneLine = input.scene === '' ? '' : ` · scene *${input.scene}*`;
  const quoted = input.quote
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return (
    `${quoted}\n\n` + `— from [${input.storyTitle}](${link}) at turn ${input.turn}${sceneLine}\n`
  );
}

/** Deep-link target for an annotation back into the player (F635). */
export function annotationLink(annotation: Annotation): string {
  return `/stories/${annotation.storyId}/play?turn=${annotation.turn}`;
}
