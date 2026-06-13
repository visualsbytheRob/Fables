/**
 * Knowledge loading for the player host (F613/F621/F623 web halves). The player
 * runs the VM client-side, so it needs the bound entities (for `@entity` and
 * `@entity.field`) and a note-title→id index (to resolve `[[lore]]` taps to a
 * note) snapshotted at session start. Both come from the normal knowledge-base
 * APIs; the host reads from these snapshots and never blocks the VM.
 */
import { entitiesApi, notesApi, type Entity, type Note } from '../api/client.js';
import { buildEntityIndex, type EntitySnapshot } from './host.js';

/** Fetch every entity (paged) so the host can resolve any `@name`. */
export async function fetchAllEntities(maxPages = 20): Promise<Entity[]> {
  const all: Entity[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await entitiesApi.list({ limit: 200, ...(cursor !== undefined ? { cursor } : {}) });
    all.push(...page.data);
    if (page.page.nextCursor === null) break;
    cursor = page.page.nextCursor;
  }
  return all;
}

/** Fetch every note (paged, capped) for the lore title→id index. */
async function fetchAllNotes(maxPages = 20): Promise<Note[]> {
  const all: Note[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await notesApi.list({ limit: 200, ...(cursor !== undefined ? { cursor } : {}) });
    all.push(...page.data);
    if (page.page.nextCursor === null) break;
    cursor = page.page.nextCursor;
  }
  return all;
}

export interface PlayerKnowledge {
  /** name/alias (lower-cased) → entity snapshot for host lookups. */
  readonly entityIndex: ReadonlyMap<string, EntitySnapshot>;
  /** note title (lower-cased) → note id, for `[[lore]]` tap resolution. */
  readonly noteTitleIndex: ReadonlyMap<string, string>;
}

/** Load and index the knowledge the player host needs for one session. */
export async function loadPlayerKnowledge(): Promise<PlayerKnowledge> {
  const [entities, notes] = await Promise.all([fetchAllEntities(), fetchAllNotes()]);
  const entityIndex = buildEntityIndex(
    entities.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, fields: e.fields })),
  );
  const noteTitleIndex = new Map<string, string>();
  for (const note of notes) {
    const key = note.title.trim().toLowerCase();
    if (key !== '' && !noteTitleIndex.has(key)) noteTitleIndex.set(key, note.id);
  }
  return { entityIndex, noteTitleIndex };
}
