/**
 * Import batch + artifact tracking (F1405 resume, F1407 provenance, F1408 rollback).
 *
 * Every artifact a run creates is recorded against its batch, which makes the run
 * fully reversible and auditable: provenance is a lookup by note id, resume is a
 * lookup of already-materialized source ids, and rollback is a delete of the
 * batch's artifacts.
 */

import { nowIso } from '@fables/core';
import type { Db } from '../../db/connection.js';

export type BatchStatus = 'running' | 'done' | 'failed' | 'rolled_back';
export type ArtifactKind = 'note' | 'notebook' | 'attachment';

export interface ImportBatch {
  id: string;
  source: string;
  status: BatchStatus;
  docCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Provenance {
  source: string;
  sourceId: string;
  batchId: string;
  importedAt: string;
}

interface BatchRow {
  id: string;
  source: string;
  status: BatchStatus;
  doc_count: number;
  created_at: string;
  updated_at: string;
}

const toBatch = (r: BatchRow): ImportBatch => ({
  id: r.id,
  source: r.source,
  status: r.status,
  docCount: r.doc_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const newBatchId = (): string => `imb_${crypto.randomUUID()}`;

export function importBatchesRepo(db: Db) {
  return {
    create(source: string, docCount: number): ImportBatch {
      const now = nowIso();
      const batch: ImportBatch = {
        id: newBatchId(),
        source,
        status: 'running',
        docCount,
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO import_batches (id, source, status, doc_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(batch.id, batch.source, batch.status, batch.docCount, batch.createdAt, batch.updatedAt);
      return batch;
    },

    get(id: string): ImportBatch | null {
      const row = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(id) as
        | BatchRow
        | undefined;
      return row ? toBatch(row) : null;
    },

    list(): ImportBatch[] {
      return (
        db.prepare('SELECT * FROM import_batches ORDER BY created_at DESC').all() as BatchRow[]
      ).map(toBatch);
    },

    setStatus(id: string, status: BatchStatus): void {
      db.prepare('UPDATE import_batches SET status = ?, updated_at = ? WHERE id = ?').run(
        status,
        nowIso(),
        id,
      );
    },

    /** Record an artifact this batch created (F1407/F1408). */
    addArtifact(
      batchId: string,
      kind: ArtifactKind,
      artifactId: string,
      ref?: { source: string; sourceId: string },
    ): void {
      db.prepare(
        `INSERT OR IGNORE INTO import_artifacts (batch_id, kind, artifact_id, source, source_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(batchId, kind, artifactId, ref?.source ?? null, ref?.sourceId ?? null, nowIso());
    },

    /** Artifact ids of a kind for a batch (rollback order: note → attachment → notebook). */
    artifacts(batchId: string, kind: ArtifactKind): string[] {
      return (
        db
          .prepare(
            'SELECT artifact_id FROM import_artifacts WHERE batch_id = ? AND kind = ? ORDER BY created_at',
          )
          .all(batchId, kind) as { artifact_id: string }[]
      ).map((r) => r.artifact_id);
    },

    /** Source ids already materialized as notes in a batch — used to resume (F1405). */
    materializedSourceIds(batchId: string): Set<string> {
      const rows = db
        .prepare(
          `SELECT source_id FROM import_artifacts
           WHERE batch_id = ? AND kind = 'note' AND source_id IS NOT NULL`,
        )
        .all(batchId) as { source_id: string }[];
      return new Set(rows.map((r) => r.source_id));
    },

    /** Provenance for an imported note (F1407): where it came from. */
    provenanceForNote(noteId: string): Provenance | null {
      const row = db
        .prepare(
          `SELECT a.source AS source, a.source_id AS source_id, a.batch_id AS batch_id,
                  a.created_at AS imported_at
           FROM import_artifacts a
           WHERE a.kind = 'note' AND a.artifact_id = ?`,
        )
        .get(noteId) as
        | { source: string | null; source_id: string | null; batch_id: string; imported_at: string }
        | undefined;
      if (!row || row.source === null || row.source_id === null) return null;
      return {
        source: row.source,
        sourceId: row.source_id,
        batchId: row.batch_id,
        importedAt: row.imported_at,
      };
    },
  };
}

export type ImportBatchesRepo = ReturnType<typeof importBatchesRepo>;
