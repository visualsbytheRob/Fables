/**
 * World-state inspector API client (F681–F688). Mirrors the server's
 * `services/world.ts` and `db/repos/world.ts` types and wraps the shared
 * `api` helper with the world routes under `/api/v1`.
 */
import { api } from '../api/client.js';

/** One entity in the world dashboard, with story-mutated fields flagged (F681). */
export interface WorldEntityView {
  id: string;
  type: string;
  name: string;
  fields: Record<string, unknown>;
  mutatedFields: Record<string, { count: number; lastAt: string; storyIds: string[] }>;
}

/** A single mutation-audit row for one entity (F682/F683). */
export interface EntityMutation {
  id: string;
  storyId: string;
  playthroughId: string;
  entityId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  kind: 'effect' | 'revert';
  sandbox: boolean;
  at: string;
}

/** Result of restoring an entity's fields from the audit (F683). */
export interface RevertResult {
  entityId: string;
  reverted: { field: string; from: unknown; to: unknown }[];
}

/** Snapshot list metadata (F684). */
export interface WorldSnapshotMeta {
  id: string;
  name: string;
  entityCount: number;
  createdAt: string;
}

export interface SnapshotFieldDiff {
  entityId: string;
  entityName: string;
  field: string;
  a: unknown;
  b: unknown;
  status: 'added' | 'removed' | 'changed';
}

export interface SnapshotDiff {
  a: { id: string; name: string };
  b: { id: string; name: string };
  fields: SnapshotFieldDiff[];
}

/** A field written by two or more distinct stories (F687). */
export interface MutationConflict {
  entityId: string;
  field: string;
  stories: { storyId: string; count: number; lastAt: string }[];
}

/** Portable world export payload (F688). */
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

export interface RevertBody {
  playthroughId?: string;
  field?: string;
}

export const worldApi = {
  /** Every entity with story-mutated fields flagged (F681). */
  dashboard: () => api.get<WorldEntityView[]>('/world'),
  /** Fields written by 2+ distinct stories (F687). */
  conflicts: () => api.get<MutationConflict[]>('/world/conflicts'),
  /** Restore an entity's fields from the audit (F683). */
  revert: (id: string, body: RevertBody = {}) =>
    api.post<RevertResult>(`/entities/${id}/revert`, body),
  /** Snapshot list metadata (F684). */
  snapshots: () => api.get<WorldSnapshotMeta[]>('/world/snapshots'),
  createSnapshot: (name: string) => api.post<WorldSnapshotMeta>('/world/snapshots', { name }),
  /** Field-level diff between two snapshots (F685). */
  diff: (a: string, b: string) => api.get<SnapshotDiff>(`/world/snapshots/${a}/diff/${b}`),
  /** Export every entity's id/type/name/fields as JSON (F688). */
  exportWorld: () => api.get<WorldExport>('/world/export'),
  /** Import a world export, upserting fields for known ids (F688). */
  importWorld: (payload: WorldExport) =>
    api.post<WorldImportResult>('/world/import', payload),
  /** The mutation-audit trail for one entity (F682). */
  entityMutations: (id: string) => api.get<EntityMutation[]>(`/entities/${id}/mutations`),
};
