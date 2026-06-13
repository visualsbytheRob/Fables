import {
  notFound,
  validation,
  type EntityId,
  type EntityType,
  type NoteId,
  type StoryId,
} from '@fables/core';
import type { Db } from '../db/connection.js';
import { codexRepo } from '../db/repos/codex.js';
import { entitiesRepo } from '../db/repos/entities.js';
import { entitySchemasRepo } from '../db/repos/entity-schemas.js';
import { storiesRepo } from '../db/repos/stories.js';
import { sha256Hex } from '../lib/hash.js';

/**
 * Codex computation (F611–F620). The codex is never stored — it is derived
 * from encounters + reveals on every read, so recompiles and edits never
 * desync it (F619). Spoiler safety is enforced here: an entry serializes
 * *only* the fields its playthrough has revealed (F618).
 */

export interface CodexEntry {
  /** Deterministic across regenerations: a hash of (storyId, entityId) (F619). */
  entryId: string;
  entityId: EntityId;
  type: EntityType;
  name: string;
  noteId: NoteId | null;
  metAt: string;
  encounters: number;
  /** Only revealed fields ever appear here — unrevealed values never serialize. */
  revealedFields: Record<string, unknown>;
}

/** Stable codex entry id (F619): identical for every regeneration. */
export function codexEntryId(storyId: StoryId, entityId: EntityId): string {
  return `cdx_${sha256Hex(`${storyId}|${entityId}`).slice(0, 24)}`;
}

export function recordEncounter(
  db: Db,
  storyId: StoryId,
  playthroughId: string,
  entityId: EntityId,
): {
  entryId: string;
  entityId: EntityId;
  playthroughId: string;
  firstAt: string;
  encounters: number;
  repeat: boolean;
} {
  storiesRepo(db).mustGet(storyId);
  const entity = entitiesRepo(db).get(entityId);
  if (!entity) throw notFound('Entity', entityId);
  const encounter = codexRepo(db).recordEncounter(storyId, playthroughId, entityId);
  return {
    entryId: codexEntryId(storyId, entityId),
    entityId,
    playthroughId,
    firstAt: encounter.firstAt,
    encounters: encounter.count,
    repeat: encounter.repeat,
  };
}

export function recordReveal(
  db: Db,
  storyId: StoryId,
  playthroughId: string,
  entityId: EntityId,
  field: string,
): { entryId: string; entityId: EntityId; field: string; revealed: boolean } {
  storiesRepo(db).mustGet(storyId);
  const entity = entitiesRepo(db).get(entityId);
  if (!entity) throw notFound('Entity', entityId);
  const schema = entitySchemasRepo(db).mustGet(entity.type);
  if (!schema.fields.some((d) => d.name === field)) {
    throw validation(`unknown field "${field}" for entity type "${entity.type}"`, {
      field,
      type: entity.type,
      knownFields: schema.fields.map((d) => d.name),
    });
  }
  const { revealed } = codexRepo(db).recordReveal(storyId, playthroughId, entityId, field);
  return { entryId: codexEntryId(storyId, entityId), entityId, field, revealed };
}

/**
 * The spoiler-safe codex for one playthrough (F612/F615/F618): only met
 * entities appear, and each entry carries only its revealed fields.
 */
export function codexFor(
  db: Db,
  storyId: StoryId,
  playthroughId: string,
): { storyId: StoryId; playthroughId: string; entries: CodexEntry[] } {
  storiesRepo(db).mustGet(storyId);
  const codex = codexRepo(db);
  const entities = entitiesRepo(db);

  const revealedByEntity = new Map<string, Set<string>>();
  for (const reveal of codex.listReveals(storyId, playthroughId)) {
    let set = revealedByEntity.get(reveal.entityId);
    if (!set) {
      set = new Set();
      revealedByEntity.set(reveal.entityId, set);
    }
    set.add(reveal.field);
  }

  const entries: CodexEntry[] = [];
  for (const encounter of codex.listEncounters(storyId, playthroughId)) {
    const entity = entities.get(encounter.entityId);
    if (!entity) continue; // entity deleted since the encounter — entry vanishes
    const revealed = revealedByEntity.get(entity.id) ?? new Set<string>();
    const revealedFields: Record<string, unknown> = {};
    for (const field of revealed) {
      if (field in entity.fields) revealedFields[field] = entity.fields[field];
    }
    entries.push({
      entryId: codexEntryId(storyId, entity.id),
      entityId: entity.id,
      type: entity.type,
      name: entity.name,
      noteId: entity.noteId,
      metAt: encounter.firstAt,
      encounters: encounter.count,
      revealedFields,
    });
  }
  return { storyId, playthroughId, entries };
}
