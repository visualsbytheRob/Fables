/**
 * Per-notebook retention policies (F1283).
 *
 * A notebook may carry a `retention_days` window; notes in it whose `updated_at`
 * is older than that window are eligible for automatic hard-deletion. Purge is
 * blocked entirely while a legal hold is active (F1286), so a compliance freeze
 * always wins over an auto-purge schedule.
 */

import type { Db } from '../db/connection.js';
import { legalHoldRepo } from './legal-hold.js';

export interface NotebookRetention {
  notebookId: string;
  retentionDays: number | null;
}

export interface PurgeResult {
  /** Total notes hard-deleted across all notebooks. */
  purged: number;
  /** True when purge was skipped because a legal hold is active. */
  blockedByLegalHold: boolean;
  /** Per-notebook breakdown of what was deleted. */
  byNotebook: { notebookId: string; deleted: number }[];
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function retentionRepo(db: Db) {
  return {
    /** Set (or clear, with null) a notebook's retention window. */
    set(notebookId: string, retentionDays: number | null): NotebookRetention {
      const changed = db
        .prepare('UPDATE notebooks SET retention_days = ? WHERE id = ?')
        .run(retentionDays, notebookId).changes;
      if (changed === 0) throw new Error(`unknown notebook ${notebookId}`);
      return { notebookId, retentionDays };
    },

    get(notebookId: string): NotebookRetention | null {
      const row = db
        .prepare('SELECT retention_days FROM notebooks WHERE id = ?')
        .get(notebookId) as { retention_days: number | null } | undefined;
      if (!row) return null;
      return { notebookId, retentionDays: row.retention_days };
    },

    /** Every notebook that currently has a retention window configured. */
    listConfigured(): NotebookRetention[] {
      const rows = db
        .prepare('SELECT id, retention_days FROM notebooks WHERE retention_days IS NOT NULL')
        .all() as { id: string; retention_days: number }[];
      return rows.map((r) => ({ notebookId: r.id, retentionDays: r.retention_days }));
    },

    /**
     * Count notes that WOULD be purged for a notebook right now (dry run).
     */
    countExpired(notebookId: string, retentionDays: number): number {
      return (
        db
          .prepare(`SELECT COUNT(*) AS n FROM notes WHERE notebook_id = ? AND updated_at < ?`)
          .get(notebookId, cutoffIso(retentionDays)) as { n: number }
      ).n;
    },

    /**
     * Hard-delete every expired note across all retention-configured notebooks
     * (F1283). No-op (blockedByLegalHold) while a legal hold is active (F1286).
     */
    purge(): PurgeResult {
      if (legalHoldRepo(db).get().active) {
        return { purged: 0, blockedByLegalHold: true, byNotebook: [] };
      }
      const byNotebook: { notebookId: string; deleted: number }[] = [];
      let purged = 0;
      for (const { notebookId, retentionDays } of this.listConfigured()) {
        if (retentionDays === null) continue;
        const deleted = db
          .prepare('DELETE FROM notes WHERE notebook_id = ? AND updated_at < ?')
          .run(notebookId, cutoffIso(retentionDays)).changes;
        if (deleted > 0) {
          byNotebook.push({ notebookId, deleted });
          purged += deleted;
        }
      }
      return { purged, blockedByLegalHold: false, byNotebook };
    },
  };
}

export type RetentionRepo = ReturnType<typeof retentionRepo>;
