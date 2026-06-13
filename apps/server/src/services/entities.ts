import {
  conflict,
  formatWikilink,
  notFound,
  validation,
  type Entity,
  type EntityFieldDef,
  type EntityId,
  type EntityRelationDef,
  type EntityType,
  type EntityTypeSchema,
  type LinkId,
  type Note,
  type NoteId,
} from '@fables/core';
import type { KnowledgeResolver } from '@fables/forge-dsl';
import { withTransaction, type Db } from '../db/connection.js';
import { entitiesRepo, type RelationMap } from '../db/repos/entities.js';
import { entitySchemasRepo } from '../db/repos/entity-schemas.js';
import { linksRepo } from '../db/repos/links.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { onEntityNamesChanged, syncNoteLinks } from './links.js';
import { applyServerEdit, createNote } from './notes.js';

/**
 * Entity domain logic (F601–F610): schema-driven field validation with
 * defaults, alias uniqueness, typed relation links, backing notes, mention
 * conversion, and the knowledge resolver the compiler binds against (F369).
 */

/** Notebook that holds backing notes created on demand. */
export const ENTITIES_NOTEBOOK = 'Entities';

const FIELD_TYPE_CHECK: Record<EntityFieldDef['fieldType'], (v: unknown) => boolean> = {
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  string: (v) => typeof v === 'string',
  bool: (v) => typeof v === 'boolean',
  list: (v) => Array.isArray(v),
};

/** Sanity-check a user-edited type schema (F602): names unique, defaults typed. */
export function validateSchemaDefinition(
  fields: EntityFieldDef[],
  relations: EntityRelationDef[],
): void {
  const seen = new Set<string>();
  for (const def of fields) {
    const key = def.name.toLowerCase();
    if (seen.has(key)) {
      throw validation(`duplicate field "${def.name}" in schema`, { field: def.name });
    }
    seen.add(key);
    if (def.default !== undefined && !FIELD_TYPE_CHECK[def.fieldType](def.default)) {
      throw validation(`default for field "${def.name}" must be a ${def.fieldType}`, {
        field: def.name,
        fieldType: def.fieldType,
      });
    }
  }
  const seenRelations = new Set<string>();
  for (const rel of relations) {
    const key = rel.name.toLowerCase();
    if (seenRelations.has(key)) {
      throw validation(`duplicate relation "${rel.name}" in schema`, { relation: rel.name });
    }
    seenRelations.add(key);
  }
}

/**
 * Validates `fields` against the type schema (F608): unknown fields rejected,
 * types enforced, defaults applied, required fields without defaults enforced.
 * Every VALIDATION error names the offending field.
 */
export function validateFields(
  schema: EntityTypeSchema,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const defs = new Map(schema.fields.map((d) => [d.name, d]));
  for (const name of Object.keys(fields)) {
    if (!defs.has(name)) {
      throw validation(`unknown field "${name}" for entity type "${schema.type}"`, {
        field: name,
        type: schema.type,
        knownFields: schema.fields.map((d) => d.name),
      });
    }
  }
  const result: Record<string, unknown> = {};
  for (const def of schema.fields) {
    const value = fields[def.name];
    if (value === undefined) {
      if (def.default !== undefined) {
        result[def.name] = def.default;
      } else if (def.required === true) {
        throw validation(`field "${def.name}" is required for entity type "${schema.type}"`, {
          field: def.name,
          type: schema.type,
        });
      }
      continue;
    }
    if (!FIELD_TYPE_CHECK[def.fieldType](value)) {
      throw validation(`field "${def.name}" must be a ${def.fieldType}`, {
        field: def.name,
        fieldType: def.fieldType,
      });
    }
    result[def.name] = value;
  }
  return result;
}

/** Validate one field assignment (effects/F608) against the entity's type schema. */
export function validateFieldValue(db: Db, entity: Entity, field: string, value: unknown): void {
  const schema = entitySchemasRepo(db).mustGet(entity.type);
  const def = schema.fields.find((d) => d.name === field);
  if (!def) {
    throw validation(`unknown field "${field}" for entity type "${entity.type}"`, {
      field,
      type: entity.type,
      knownFields: schema.fields.map((d) => d.name),
    });
  }
  if (!FIELD_TYPE_CHECK[def.fieldType](value)) {
    throw validation(`field "${field}" must be a ${def.fieldType}`, {
      field,
      fieldType: def.fieldType,
    });
  }
}

/** Aliases + name must be globally unique across entity names and aliases (F605). */
function checkNameUniqueness(db: Db, names: string[], excludeId?: EntityId): void {
  const lc = names.map((n) => n.toLowerCase());
  const dupes = lc.filter((n, i) => lc.indexOf(n) !== i);
  if (dupes.length > 0) {
    throw validation(`duplicate name/alias "${dupes[0]}" in request`, { name: dupes[0] });
  }
  for (const entity of entitiesRepo(db).listAll()) {
    if (entity.id === excludeId) continue;
    const taken = [entity.name, ...entity.aliases].map((n) => n.toLowerCase());
    for (const name of lc) {
      if (taken.includes(name)) {
        throw conflict(`name or alias "${name}" is already used by entity "${entity.name}"`, {
          name,
          entityId: entity.id,
        });
      }
    }
  }
}

/** Relation values must match the schema's relation slots and target types (F606). */
function validateRelations(db: Db, schema: EntityTypeSchema, relations: RelationMap): void {
  const defs = new Map(schema.relations.map((r) => [r.name, r]));
  const entities = entitiesRepo(db);
  for (const [name, targets] of Object.entries(relations)) {
    const def = defs.get(name);
    if (!def) {
      throw validation(`unknown relation "${name}" for entity type "${schema.type}"`, {
        relation: name,
        type: schema.type,
        knownRelations: schema.relations.map((r) => r.name),
      });
    }
    for (const targetId of targets) {
      const target = entities.get(targetId);
      if (!target) throw notFound('Entity', targetId);
      if (def.targetType !== null && target.type !== def.targetType) {
        throw validation(
          `relation "${name}" must target a ${def.targetType}, but "${target.name}" is a ${target.type}`,
          { relation: name, targetId, expected: def.targetType, actual: target.type },
        );
      }
    }
  }
}

export interface EntityView extends Entity {
  relations: RelationMap;
}

export function entityView(db: Db, entity: Entity): EntityView {
  return { ...entity, relations: entitiesRepo(db).relations(entity.id) };
}

export function createEntity(
  db: Db,
  input: {
    type: EntityType;
    name: string;
    aliases?: string[];
    fields?: Record<string, unknown>;
    relations?: RelationMap;
  },
): EntityView {
  return withTransaction(db, () => {
    const schema = entitySchemasRepo(db).mustGet(input.type);
    const aliases = input.aliases ?? [];
    checkNameUniqueness(db, [input.name, ...aliases]);
    const fields = validateFields(schema, input.fields ?? {});
    const relations = input.relations ?? {};
    validateRelations(db, schema, relations);

    const entity = entitiesRepo(db).create({ type: input.type, name: input.name, aliases, fields });
    entitiesRepo(db).replaceRelations(entity.id, relations);
    onEntityNamesChanged(db, entity);
    return entityView(db, entity);
  });
}

export function updateEntity(
  db: Db,
  id: EntityId,
  patch: {
    name?: string;
    aliases?: string[];
    fields?: Record<string, unknown>;
    relations?: RelationMap;
  },
): EntityView {
  return withTransaction(db, () => {
    const repo = entitiesRepo(db);
    const current = repo.mustGet(id);
    const schema = entitySchemasRepo(db).mustGet(current.type);

    const name = patch.name ?? current.name;
    const aliases = patch.aliases ?? current.aliases;
    if (patch.name !== undefined || patch.aliases !== undefined) {
      checkNameUniqueness(db, [name, ...aliases], id);
    }
    // Field patches merge into the stored fields, then the whole map re-validates.
    const fields =
      patch.fields === undefined
        ? current.fields
        : validateFields(schema, { ...current.fields, ...patch.fields });
    if (patch.relations !== undefined) validateRelations(db, schema, patch.relations);

    const updated = repo.update(id, { name, aliases, fields });
    if (patch.relations !== undefined) repo.replaceRelations(id, patch.relations);

    const namesChanged =
      name !== current.name || JSON.stringify(aliases) !== JSON.stringify(current.aliases);
    if (namesChanged) onEntityNamesChanged(db, updated, [current.name, ...current.aliases]);
    return entityView(db, updated);
  });
}

export function deleteEntity(db: Db, id: EntityId): void {
  withTransaction(db, () => {
    entitiesRepo(db).remove(id);
  });
}

/**
 * Backing-note linkage (F601/F609): finds the live backing note or creates one
 * on demand in the Entities notebook, titled after the entity.
 */
export function ensureBackingNote(
  db: Db,
  id: EntityId,
): { entity: EntityView; note: Note; created: boolean } {
  return withTransaction(db, () => {
    const repo = entitiesRepo(db);
    const entity = repo.mustGet(id);
    if (entity.noteId !== null) {
      const existing = notesRepo(db).get(entity.noteId);
      if (existing && existing.trashedAt === null) {
        return { entity: entityView(db, entity), note: existing, created: false };
      }
    }
    const notebooks = notebooksRepo(db);
    const notebook =
      notebooks.list({ includeArchived: true }).find((n) => n.name === ENTITIES_NOTEBOOK) ??
      notebooks.create({ name: ENTITIES_NOTEBOOK });
    const note = createNote(db, {
      notebookId: notebook.id,
      title: entity.name,
      body: `# ${entity.name}\n\n_${entity.type}_\n\nNotes about ${entity.name} go here.\n`,
    });
    const updated = repo.update(id, { noteId: note.id });
    // The note was scanned before it became the backing note — resync so it
    // doesn't carry self-mentions of its own entity.
    syncNoteLinks(db, note);
    return { entity: entityView(db, updated), note, created: true };
  });
}

/** Characters a wikilink target can never contain. */
const UNLINKABLE_TITLE_RE = /[[\]|#^\n]/;

/**
 * Converts unlinked mentions of an entity into wikilinks to its backing note
 * (F605): `[[Name]]` for exact name matches, `[[Name|matched text]]` for
 * alias/case variants. Creates the backing note on demand.
 */
export function convertEntityMentions(
  db: Db,
  id: EntityId,
  opts: { mentionId?: LinkId; all?: boolean },
): { converted: number; sources: number; noteId: NoteId } {
  return withTransaction(db, () => {
    const entity = entitiesRepo(db).mustGet(id);
    if (UNLINKABLE_TITLE_RE.test(entity.name)) {
      throw validation('entity name cannot appear in a wikilink', { name: entity.name });
    }
    const { note } = ensureBackingNote(db, id);

    const links = linksRepo(db);
    let rows;
    if (opts.all === true) {
      rows = links.incoming(id, 'mention');
    } else {
      const row = opts.mentionId === undefined ? null : links.get(opts.mentionId);
      if (!row || row.kind !== 'mention' || row.targetId !== id) {
        throw notFound('Mention', opts.mentionId);
      }
      rows = [row];
    }

    const bySource = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!bySource.has(row.sourceId)) bySource.set(row.sourceId, []);
      bySource.get(row.sourceId)!.push(row);
    }

    let converted = 0;
    let sources = 0;
    for (const [sourceId, sourceRows] of bySource) {
      const source = notesRepo(db).get(sourceId as NoteId);
      if (!source) continue;
      let body = source.body;
      // Splice back-to-front so earlier offsets stay valid.
      for (const row of [...sourceRows].sort((a, b) => b.position - a.position)) {
        const text = body.slice(row.position, row.position + row.length);
        if (text.toLowerCase() !== row.targetTitle) continue; // stale row — skip defensively
        const replacement =
          text === note.title
            ? formatWikilink({ target: note.title })
            : formatWikilink({ target: note.title, alias: text });
        body = body.slice(0, row.position) + replacement + body.slice(row.position + row.length);
        converted += 1;
      }
      if (body !== source.body) {
        applyServerEdit(db, sourceId as NoteId, { body });
        sources += 1;
      }
    }
    return { converted, sources, noteId: note.id };
  });
}

/**
 * The knowledge resolver the forge-dsl compiler binds `@entity` references and
 * `[[note]]` references against (F369/F609). Entities resolve by name or alias
 * (case-insensitive); field types map 1:1 onto ForgeTypes.
 */
export function knowledgeResolver(db: Db): KnowledgeResolver {
  return {
    resolveEntity(name) {
      const entity = entitiesRepo(db).getByName(name);
      if (!entity) return null;
      const schema = entitySchemasRepo(db).get(entity.type);
      const fields: Record<string, 'number' | 'string' | 'bool' | 'list'> = {};
      for (const def of schema?.fields ?? []) fields[def.name] = def.fieldType;
      return { name: entity.name, fields };
    },
    resolveNote(title) {
      const titleLc = title.toLowerCase();
      return notesRepo(db)
        .listTitles()
        .some((n) => n.title.toLowerCase() === titleLc);
    },
    entityNames() {
      return entitiesRepo(db)
        .listNames()
        .flatMap((e) => e.names);
    },
  };
}
