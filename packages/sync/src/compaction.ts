/**
 * Op compaction: squash old ops into per-entity snapshots (F836).
 *
 * Pure functions — the actual DB write is done by the server layer.
 */

import type { SyncOp, EntitySnapshot } from './types.js';
import { compareLamport } from './clock.js';

export interface CompactionInput {
  entityId: string;
  domain: 'note' | 'entity' | 'save_slot';
  ops: SyncOp[]; // all ops for this entity, any order
}

/**
 * Fold a series of ops for a single entity into a snapshot payload.
 *
 * Strategy: sort by lamport ascending, replay with LWW.
 * The snapshot captures the final field state after all ops.
 */
export function compactEntity(input: CompactionInput): EntitySnapshot | null {
  const ops = [...input.ops]
    .filter((o) => o.entityId === input.entityId)
    .sort((a, b) =>
      compareLamport(
        { lamport: a.lamport, deviceId: a.deviceId },
        { lamport: b.lamport, deviceId: b.deviceId },
      ),
    );

  if (ops.length === 0) return null;

  const lastOp = ops[ops.length - 1]!;

  // Fold into a payload map by replaying field writes
  const payload: Record<string, unknown> = {};
  let isDeleted = false;

  for (const op of ops) {
    if (op.opType === 'delete') {
      isDeleted = true;
      payload['deletedAt'] = op.clientCreatedAt;
    } else if (op.opType === 'restore') {
      isDeleted = false;
      payload['deletedAt'] = null;
    } else if ('payload' in op && op.payload && typeof op.payload === 'object') {
      for (const [k, v] of Object.entries(op.payload)) {
        if (v !== undefined) payload[k] = v;
      }
    }
  }

  payload['entityId'] = input.entityId;
  payload['isDeleted'] = isDeleted;

  // Find highest serverSeq among ops (server stamps ops; we take max)
  // For client-side compaction testing, serverSeq is 0 if not present.
  const throughSeq = 0; // Server fills this in at write time

  return {
    domain: input.domain,
    entityId: input.entityId,
    throughLamport: lastOp.lamport,
    throughSeq,
    payload,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Identify entities eligible for compaction: those with more than
 * `threshold` ops AND whose ops are all older than `olderThanSeq`.
 */
export function findCompactionCandidates(
  ops: Array<SyncOp & { serverSeq: number }>,
  threshold: number,
  olderThanSeq: number,
): Map<string, Array<SyncOp & { serverSeq: number }>> {
  // Group by entityId
  const groups = new Map<string, Array<SyncOp & { serverSeq: number }>>();
  for (const op of ops) {
    const arr = groups.get(op.entityId) ?? [];
    arr.push(op);
    groups.set(op.entityId, arr);
  }

  const candidates = new Map<string, Array<SyncOp & { serverSeq: number }>>();
  for (const [entityId, entityOps] of groups) {
    const allOld = entityOps.every((o) => o.serverSeq < olderThanSeq);
    if (allOld && entityOps.length >= threshold) {
      candidates.set(entityId, entityOps);
    }
  }
  return candidates;
}
