/**
 * Data-integrity checksum comparison per table (F867).
 * Pure functions — no database access.
 */

import type { TableChecksum } from './types.js';

/**
 * Compute a simple order-independent checksum over a set of entity IDs.
 *
 * Algorithm: XOR-fold a FNV-32 hash of each ID string.
 * - Deterministic across environments (no Math.random, no platform-specific hash)
 * - Order-independent (XOR is commutative)
 * - Fast: O(n * |id|)
 */
export function computeChecksum(ids: string[]): string {
  let acc = 0;
  for (const id of ids) {
    acc ^= fnv32(id);
  }
  return acc.toString(16).padStart(8, '0');
}

function fnv32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // Multiply by FNV prime (32-bit): 0x01000193
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Build a TableChecksum from a list of IDs.
 */
export function buildChecksum(table: string, ids: string[]): TableChecksum {
  return {
    table,
    rowCount: ids.length,
    checksum: computeChecksum(ids),
  };
}

/**
 * Compare client and server checksums. Returns a list of tables that diverge.
 */
export function compareChecksums(
  client: TableChecksum[],
  server: TableChecksum[],
): { table: string; clientChecksum: string; serverChecksum: string }[] {
  const serverMap = new Map(server.map((s) => [s.table, s]));
  const diverged: { table: string; clientChecksum: string; serverChecksum: string }[] = [];

  for (const c of client) {
    const s = serverMap.get(c.table);
    if (!s || s.checksum !== c.checksum || s.rowCount !== c.rowCount) {
      diverged.push({
        table: c.table,
        clientChecksum: c.checksum,
        serverChecksum: s?.checksum ?? '(missing)',
      });
    }
  }
  return diverged;
}
