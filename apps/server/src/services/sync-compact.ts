/**
 * Op compaction job (F836).
 *
 * Squashes old ops for an entity into a per-entity snapshot, then deletes
 * the source ops. This keeps the ops table from growing unboundedly.
 *
 * Compaction threshold: entities with ≥ 10 ops all older than 1000 seqs
 * behind the current head are candidates.
 */

import type { Db } from '../db/connection.js';
import { compactEntity } from '@fables/sync';
import type { syncRepo } from '../db/repos/sync.js';

// 10 ops per entity minimum before compacting
const COMPACTION_THRESHOLD = 10;
// Only compact ops at least 1000 seqs behind current (i.e., not recent)
const COMPACTION_LAG = 1000;

export interface CompactionResult {
  candidates: number;
  compacted: number;
  errors: string[];
}

export function runCompactionJob(_db: Db, repo: ReturnType<typeof syncRepo>): CompactionResult {
  void _db; // used indirectly via repo
  // Find current max seq
  const currentOps = repo.pendingOpCount();
  if (currentOps === 0) return { candidates: 0, compacted: 0, errors: [] };

  // Get all ops to find max seq — use the pull endpoint's result
  const allRecent = repo.pullOpsSince(0, 1);
  if (allRecent.length === 0) return { candidates: 0, compacted: 0, errors: [] };

  const maxSeq = allRecent[0]?.serverSeq ?? 0;
  const olderThanSeq = Math.max(0, maxSeq - COMPACTION_LAG);

  const candidates = repo.compactionCandidates(COMPACTION_THRESHOLD, olderThanSeq);
  const errors: string[] = [];
  let compacted = 0;

  for (const c of candidates) {
    try {
      const ops = repo.opsForEntity(c.entityId, c.domain);
      const snapshot = compactEntity({
        entityId: c.entityId,
        domain: c.domain as 'note' | 'entity' | 'save_slot',
        ops,
      });
      if (snapshot) {
        // Find the through_seq from the ops
        const maxSeqForEntity = Math.max(...ops.map((o) => o.serverSeq));
        repo.saveSnapshot({ ...snapshot, throughSeq: maxSeqForEntity });
        compacted++;
      }
    } catch (e) {
      errors.push(
        `compaction failed for ${c.domain}/${c.entityId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { candidates: candidates.length, compacted, errors };
}
