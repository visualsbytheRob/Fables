/**
 * Conflict store — tracks pending sync conflicts surfaced to the user (F844/F848).
 *
 * When the sync engine detects an irresolvable conflict (threeWayMerge ok:false),
 * the conflict is persisted to IDB kv and surfaced via this store.
 *
 * Conflict structure:
 *   - id: stable uuid for this conflict
 *   - entityId: the note or entity being conflicted
 *   - domain: 'note' | 'entity'
 *   - field: which field conflicts (e.g. 'body', 'name', or a custom field)
 *   - localText: local version
 *   - remoteText: remote version
 *   - baseText: common ancestor (if available)
 *   - localLamport: local op's Lamport clock
 *   - remoteLamport: remote op's Lamport clock
 *   - detectedAt: ISO timestamp
 *   - resolvedAt: ISO timestamp or null
 *   - resolution: 'pick-mine' | 'pick-theirs' | 'keep-both' | null
 */

import { kvStore } from './idb.js';

export type ConflictDomain = 'note' | 'entity';
export type ConflictResolution = 'pick-mine' | 'pick-theirs' | 'keep-both';

export interface SyncConflict {
  id: string;
  entityId: string;
  domain: ConflictDomain;
  field: string;
  localText: string;
  remoteText: string;
  baseText: string;
  localLamport: number;
  remoteLamport: number;
  detectedAt: string;
  resolvedAt: string | null;
  resolution: ConflictResolution | null;
}

const KV_CONFLICTS = 'sync:conflicts';

async function loadAll(): Promise<SyncConflict[]> {
  return (await kvStore.get<SyncConflict[]>(KV_CONFLICTS)) ?? [];
}

async function saveAll(conflicts: SyncConflict[]): Promise<void> {
  await kvStore.set(KV_CONFLICTS, conflicts);
}

export const conflictStore = {
  /** List all unresolved conflicts. */
  listPending: async (): Promise<SyncConflict[]> => {
    const all = await loadAll();
    return all.filter((c) => c.resolvedAt === null);
  },

  /** List all conflicts (including resolved). */
  listAll: async (): Promise<SyncConflict[]> => {
    return loadAll();
  },

  /** Add a new conflict record. */
  add: async (conflict: Omit<SyncConflict, 'id' | 'detectedAt' | 'resolvedAt' | 'resolution'>): Promise<SyncConflict> => {
    const all = await loadAll();
    const newConflict: SyncConflict = {
      ...conflict,
      id: crypto.randomUUID(),
      detectedAt: new Date().toISOString(),
      resolvedAt: null,
      resolution: null,
    };
    all.push(newConflict);
    await saveAll(all);
    return newConflict;
  },

  /** Resolve a conflict with the given strategy. */
  resolve: async (id: string, resolution: ConflictResolution): Promise<SyncConflict | null> => {
    const all = await loadAll();
    const idx = all.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    const updated = {
      ...all[idx]!,
      resolvedAt: new Date().toISOString(),
      resolution,
    };
    all[idx] = updated;
    await saveAll(all);
    return updated;
  },

  /** Count pending (unresolved) conflicts. */
  countPending: async (): Promise<number> => {
    const pending = await conflictStore.listPending();
    return pending.length;
  },

  /** Check if a specific entity/field has a pending conflict. */
  hasConflict: async (entityId: string, field?: string): Promise<boolean> => {
    const pending = await conflictStore.listPending();
    return pending.some(
      (c) => c.entityId === entityId && (field === undefined || c.field === field),
    );
  },
};
