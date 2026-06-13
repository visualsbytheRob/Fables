import { type EntityId, type StoryId } from '@fables/core';
import { findAllBindings, parse } from '@fables/forge-dsl';
import type { Db } from '../db/connection.js';
import { entitiesRepo } from '../db/repos/entities.js';
import { entitySchemasRepo } from '../db/repos/entity-schemas.js';
import { notesRepo } from '../db/repos/notes.js';
import { playthroughsRepo } from '../db/repos/playthroughs.js';
import { storiesRepo } from '../db/repos/stories.js';
import { tagsRepo } from '../db/repos/tags.js';
import { worldRepo } from '../db/repos/world.js';
import { sha256Hex } from '../lib/hash.js';
import { canRead, storyDeclarations } from './permissions.js';

/**
 * Knowledge-state binding payload (F641–F650). The player injects this into the
 * VM to evaluate `{ @note.exists("...") }`, `{ @hero.health > 50 }`, and
 * tag-presence conditions.
 *
 * - Scans the story's .fable sources to learn which entities/notes/tags the
 *   conditions reference, then serves their current values (F641–F643).
 * - Respects the permission model: only declared-readable entities appear (F648).
 * - Missing data yields typed defaults plus a warning entry (F649).
 * - Carries a deterministic version hash for cheap-poll invalidation (F645).
 * - Live mode reads current state; snapshot mode freezes the payload at
 *   playthrough start and serves the frozen copy thereafter (F644).
 */

export type FieldValue = number | string | boolean | unknown[] | null;

export interface EntityBinding {
  entityId: EntityId | null;
  name: string;
  /** Field name → current value (or typed default when missing, F649). */
  fields: Record<string, FieldValue>;
  /** True when the named entity does not exist in the knowledge base. */
  missing: boolean;
}

export interface KnowledgeWarning {
  kind: 'missing-entity' | 'missing-field' | 'missing-note' | 'forbidden-entity';
  ref: string;
  message: string;
}

export interface KnowledgeState {
  storyId: StoryId;
  playthroughId: string;
  /** 'live' re-reads on every request; 'snapshot' serves the frozen payload (F644). */
  mode: 'live' | 'snapshot';
  /** Lowercased entity name → binding (only declared-readable entities, F648). */
  entities: Record<string, EntityBinding>;
  /** Lowercased note title → exists flag (F641). */
  notes: Record<string, boolean>;
  /** Tag name → present (a live note carries it) (F643). */
  tags: Record<string, boolean>;
  warnings: KnowledgeWarning[];
  /** Deterministic content hash for cheap-poll invalidation (F645). */
  version: string;
}

/** Typed zero value for a field type — the default missing data falls back to (F649). */
function typedDefault(fieldType: 'number' | 'string' | 'bool' | 'list'): FieldValue {
  switch (fieldType) {
    case 'number':
      return 0;
    case 'string':
      return '';
    case 'bool':
      return false;
    case 'list':
      return [];
  }
}

interface ScannedRefs {
  /** Lowercased entity name → set of referenced field names (no field ⇒ presence only). */
  entities: Map<string, Set<string>>;
  /** Lowercased note titles referenced via `[[note]]`. */
  notes: Set<string>;
}

/** Collect every `@entity(.field)?` and `[[note]]` reference across a story's sources. */
function scanStoryRefs(db: Db, storyId: StoryId): ScannedRefs {
  const entities = new Map<string, Set<string>>();
  const notes = new Set<string>();
  for (const file of storiesRepo(db).listFiles(storyId)) {
    let parsed;
    try {
      parsed = parse(file.source, { fileName: file.path });
    } catch {
      continue; // unparseable file contributes no refs
    }
    for (const ref of findAllBindings(parsed.story)) {
      if (ref.kind === 'EntityRef') {
        const name = (ref.displayName ?? ref.name).toLowerCase();
        const fields = entities.get(name) ?? new Set<string>();
        if (ref.field !== undefined) fields.add(ref.field);
        entities.set(name, fields);
      } else {
        notes.add(ref.title.toLowerCase());
      }
    }
  }
  return entities.size === 0 && notes.size === 0 ? scanFallback(db, storyId, entities, notes) : { entities, notes };
}

/**
 * When a story references nothing yet, expose its declared-readable entities so
 * the payload is still useful for authoring/preview (F646-adjacent).
 */
function scanFallback(
  db: Db,
  storyId: StoryId,
  entities: Map<string, Set<string>>,
  notes: Set<string>,
): ScannedRefs {
  const decl = storyDeclarations(db, storyId);
  for (const name of [...decl.entities, ...decl.reads, ...decl.writes]) {
    entities.set(name.toLowerCase(), new Set());
  }
  return { entities, notes };
}

/** Build the live knowledge-state payload for a story (no snapshot indirection). */
export function computeKnowledgeState(
  db: Db,
  storyId: StoryId,
  playthroughId: string,
  overlay?: Map<EntityId, Record<string, unknown>>,
): Omit<KnowledgeState, 'mode'> {
  storiesRepo(db).mustGet(storyId);
  const decl = storyDeclarations(db, storyId);
  const refs = scanStoryRefs(db, storyId);
  const entities = entitiesRepo(db);
  const schemas = entitySchemasRepo(db);
  const warnings: KnowledgeWarning[] = [];

  const entityBindings: Record<string, EntityBinding> = {};
  for (const [nameLc, fieldNames] of [...refs.entities.entries()].sort()) {
    const entity = entities.getByName(nameLc);
    if (!entity) {
      warnings.push({
        kind: 'missing-entity',
        ref: nameLc,
        message: `no entity named "${nameLc}" exists`,
      });
      entityBindings[nameLc] = { entityId: null, name: nameLc, fields: {}, missing: true };
      continue;
    }
    // Permission gate (F648): undeclared-readable entities never serialize.
    if (!canRead(decl, entity)) {
      warnings.push({
        kind: 'forbidden-entity',
        ref: entity.name,
        message: `story may not read entity "${entity.name}"`,
      });
      continue;
    }
    const schema = schemas.get(entity.type);
    const schemaFields = new Map((schema?.fields ?? []).map((f) => [f.name, f.fieldType]));
    const overlaid = overlay?.get(entity.id) ?? {};
    const merged = { ...entity.fields, ...overlaid };
    // No specific fields referenced ⇒ expose every schema field.
    const wanted = fieldNames.size > 0 ? [...fieldNames] : [...schemaFields.keys()];
    const fields: Record<string, FieldValue> = {};
    for (const fieldName of wanted) {
      if (fieldName in merged) {
        fields[fieldName] = merged[fieldName] as FieldValue;
      } else {
        const fieldType = schemaFields.get(fieldName);
        fields[fieldName] = fieldType === undefined ? null : typedDefault(fieldType);
        warnings.push({
          kind: 'missing-field',
          ref: `${entity.name}.${fieldName}`,
          message: `entity "${entity.name}" has no value for field "${fieldName}"; using a typed default`,
        });
      }
    }
    entityBindings[nameLc] = {
      entityId: entity.id,
      name: entity.name,
      fields,
      missing: false,
    };
  }

  const noteFlags: Record<string, boolean> = {};
  const titles = new Set(notesRepo(db).listTitles().map((n) => n.title.toLowerCase()));
  for (const titleLc of [...refs.notes].sort()) {
    const exists = titles.has(titleLc);
    noteFlags[titleLc] = exists;
    if (!exists) {
      warnings.push({
        kind: 'missing-note',
        ref: titleLc,
        message: `no note titled "${titleLc}" exists`,
      });
    }
  }

  // Tag-presence the declarations asked the feed to report (F643).
  const tagFlags: Record<string, boolean> = {};
  if (decl.tags.length > 0) {
    const counts = new Map(tagsRepo(db).listWithCounts().map((t) => [t.name, t.noteCount]));
    for (const name of [...decl.tags].sort()) {
      tagFlags[name] = (counts.get(name) ?? 0) > 0;
    }
  }

  const version = sha256Hex(
    JSON.stringify({ entities: entityBindings, notes: noteFlags, tags: tagFlags }),
  ).slice(0, 24);

  return {
    storyId,
    playthroughId,
    entities: entityBindings,
    notes: noteFlags,
    tags: tagFlags,
    warnings,
    version,
  };
}

/**
 * Knowledge-state for a playthrough, honouring its binding mode (F644) and
 * sandbox overlay (F686). Snapshot mode serves the frozen payload captured at
 * playthrough start; live mode recomputes each call.
 */
export function knowledgeStateFor(
  db: Db,
  storyId: StoryId,
  playthroughId: string,
): KnowledgeState {
  const playthrough = playthroughsRepo(db).get(storyId, playthroughId);

  if (playthrough?.mode === 'snapshot' && playthrough.snapshot !== null) {
    return { ...(playthrough.snapshot as unknown as Omit<KnowledgeState, 'mode'>), mode: 'snapshot' };
  }

  const overlay =
    playthrough?.sandbox === true
      ? worldRepo(db).sandboxOverlay(storyId, playthroughId)
      : undefined;
  const state = computeKnowledgeState(db, storyId, playthroughId, overlay);
  return { ...state, mode: playthrough?.mode ?? 'live' };
}
