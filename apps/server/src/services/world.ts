import { notFound, validation, type EntityId, type StoryId } from '@fables/core';
import { z } from 'zod';
import { withTransaction, type Db } from '../db/connection.js';
import { codexRepo, type EntityMutation } from '../db/repos/codex.js';
import { entitiesRepo } from '../db/repos/entities.js';
import { worldRepo, type SnapshotEntity, type WorldSnapshot } from '../db/repos/world.js';

/**
 * World-state inspector domain logic (F681–F690): the mutated-field dashboard,
 * per-field/per-playthrough revert from the audit trail, named snapshots and
 * their field-level diff, and the mutation-audit retention job.
 */

export interface WorldEntityView {
  id: EntityId;
  type: string;
  name: string;
  fields: Record<string, unknown>;
  /** Fields a live story write has touched, with provenance (F681). */
  mutatedFields: Record<string, { count: number; lastAt: string; storyIds: StoryId[] }>;
}

/** Every entity with story-mutated fields flagged (F681). */
export function worldDashboard(db: Db): WorldEntityView[] {
  const summary = codexRepo(db).mutatedFieldSummary();
  return entitiesRepo(db)
    .listAll()
    .map((e) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      fields: e.fields,
      mutatedFields: summary.get(e.id) ?? {},
    }));
}

/** Capture the full entity field state as a snapshot payload (F684). */
function snapshotEntities(db: Db): SnapshotEntity[] {
  return entitiesRepo(db)
    .listAll()
    .map((e) => ({ id: e.id, type: e.type, name: e.name, fields: e.fields }));
}

export function createWorldSnapshot(db: Db, name: string): WorldSnapshot {
  return withTransaction(db, () => worldRepo(db).createSnapshot(name, snapshotEntities(db)));
}

// ── revert (F683) ───────────────────────────────────────────────────────────

export interface RevertResult {
  entityId: EntityId;
  reverted: { field: string; from: unknown; to: unknown }[];
}

/**
 * Restore an entity's fields from the mutation audit (F683). With no filters,
 * every mutated field rolls back to its pre-mutation value; `playthroughId`
 * and/or `field` narrow the scope. The restore writes the entity, then records
 * a `revert`-kind audit row per field so the action stays audited.
 */
export function revertEntity(
  db: Db,
  entityId: EntityId,
  opts: { playthroughId?: string; field?: string } = {},
): RevertResult {
  return withTransaction(db, () => {
    const entities = entitiesRepo(db);
    const codex = codexRepo(db);
    const entity = entities.mustGet(entityId);

    const mutations = codex
      .listMutationsForEntity(entityId, {
        ...(opts.playthroughId !== undefined ? { playthroughId: opts.playthroughId } : {}),
        ...(opts.field !== undefined ? { field: opts.field } : {}),
      })
      .filter((m: EntityMutation) => m.kind === 'effect' && !m.sandbox);

    if (mutations.length === 0) {
      throw notFound('Mutation', `${entityId}${opts.field ? `:${opts.field}` : ''}`);
    }

    // Oldest pre-mutation value per field is the true original to restore to;
    // remember the latest story that touched it so the revert row keeps a valid
    // story_id (the audit table references stories).
    const original = new Map<string, unknown>();
    const lastStory = new Map<string, StoryId>();
    for (const m of mutations) {
      if (!original.has(m.field)) original.set(m.field, m.oldValue);
      lastStory.set(m.field, m.storyId);
    }

    const nextFields = { ...entity.fields };
    const reverted: RevertResult['reverted'] = [];
    for (const [field, oldValue] of original) {
      const from = nextFields[field] ?? null;
      if (oldValue === null || oldValue === undefined) delete nextFields[field];
      else nextFields[field] = oldValue;
      reverted.push({ field, from, to: oldValue });
    }

    entities.update(entityId, { fields: nextFields });
    for (const { field, from, to } of reverted) {
      codex.recordMutation({
        storyId: lastStory.get(field)!,
        playthroughId: opts.playthroughId ?? '',
        entityId,
        field,
        oldValue: from,
        newValue: to,
        kind: 'revert',
      });
    }
    return { entityId, reverted };
  });
}

// ── snapshot diff (F685) ─────────────────────────────────────────────────────

export interface SnapshotFieldDiff {
  entityId: string;
  entityName: string;
  field: string;
  /** null when the field is absent on that side. */
  a: unknown;
  b: unknown;
  status: 'added' | 'removed' | 'changed';
}

export interface SnapshotDiff {
  a: { id: string; name: string };
  b: { id: string; name: string };
  fields: SnapshotFieldDiff[];
}

/** Field-level diff between two named snapshots (F685). */
export function diffSnapshots(db: Db, aId: string, bId: string): SnapshotDiff {
  const repo = worldRepo(db);
  const a = repo.mustGetSnapshot(aId);
  const b = repo.mustGetSnapshot(bId);
  const aByEntity = new Map(a.entities.map((e) => [e.id, e]));
  const bByEntity = new Map(b.entities.map((e) => [e.id, e]));

  const fields: SnapshotFieldDiff[] = [];
  const entityIds = [...new Set([...aByEntity.keys(), ...bByEntity.keys()])].sort();
  for (const id of entityIds) {
    const ea = aByEntity.get(id);
    const eb = bByEntity.get(id);
    const name = (eb ?? ea)!.name;
    const fieldNames = [
      ...new Set([...Object.keys(ea?.fields ?? {}), ...Object.keys(eb?.fields ?? {})]),
    ].sort();
    for (const field of fieldNames) {
      const inA = ea !== undefined && field in ea.fields;
      const inB = eb !== undefined && field in eb.fields;
      const va = inA ? ea!.fields[field] : null;
      const vb = inB ? eb!.fields[field] : null;
      if (inA && inB) {
        if (JSON.stringify(va) !== JSON.stringify(vb)) {
          fields.push({ entityId: id, entityName: name, field, a: va, b: vb, status: 'changed' });
        }
      } else if (inB) {
        fields.push({ entityId: id, entityName: name, field, a: null, b: vb, status: 'added' });
      } else {
        fields.push({ entityId: id, entityName: name, field, a: va, b: null, status: 'removed' });
      }
    }
  }
  return {
    a: { id: a.id, name: a.name },
    b: { id: b.id, name: b.name },
    fields,
  };
}

// ── export / import (F688) ────────────────────────────────────────────────────

export interface WorldExportEntity {
  id: string;
  type: string;
  name: string;
  fields: Record<string, unknown>;
}

export interface WorldExport {
  version: number;
  entities: WorldExportEntity[];
}

export interface WorldImportResult {
  imported: number;
  skipped: number;
}

export const WORLD_EXPORT_VERSION = 1;

const worldImportSchema = z.object({
  version: z.number().int().positive(),
  entities: z
    .array(
      z.object({
        id: z.string().min(1),
        type: z.string().min(1),
        name: z.string().min(1),
        fields: z.record(z.string(), z.unknown()),
      }),
    )
    .max(100_000),
});

/** Serialise every entity's id/type/name/fields as a portable JSON payload (F688). */
export function exportWorld(db: Db): WorldExport {
  const entities = entitiesRepo(db)
    .listAll()
    .map((e) => ({ id: e.id, type: e.type, name: e.name, fields: e.fields }));
  return { version: WORLD_EXPORT_VERSION, entities };
}

/**
 * Upsert entity fields from an export payload (F688). Conservative: rows whose
 * `id` matches an existing entity have their fields replaced; unknown ids are
 * skipped (we never create entities, to avoid resurrecting deleted state). The
 * payload shape is validated before any write.
 */
export function importWorld(db: Db, payload: unknown): WorldImportResult {
  const parsed = worldImportSchema.safeParse(payload);
  if (!parsed.success) {
    throw validation('invalid world export payload', { issues: parsed.error.issues });
  }
  return withTransaction(db, () => {
    const entities = entitiesRepo(db);
    let imported = 0;
    let skipped = 0;
    for (const row of parsed.data.entities) {
      const existing = entities.get(row.id as EntityId);
      if (existing === null) {
        skipped += 1;
        continue;
      }
      entities.update(row.id as EntityId, { fields: row.fields });
      imported += 1;
    }
    return { imported, skipped };
  });
}

// ── retention (F690) ──────────────────────────────────────────────────────────

export const MUTATION_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Drop mutation-audit rows older than the retention window (F690). */
export function pruneMutationAudit(db: Db, now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - MUTATION_RETENTION_DAYS * DAY_MS).toISOString();
  return codexRepo(db).pruneMutations(cutoff);
}

/** Validate a snapshot name before creation (mirrors note title constraints). */
export function assertSnapshotName(name: string): void {
  if (name.trim() === '') throw validation('snapshot name must not be empty');
}
