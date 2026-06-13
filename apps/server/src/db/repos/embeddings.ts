/**
 * Embeddings repo (F724–F726): CRUD + coverage stats for the embeddings table.
 *
 * Vectors are stored as JSON text arrays of floats — no native extensions required.
 * The chunk_hash guards against re-embedding unchanged content.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../connection.js';

export interface EmbeddingRow {
  id: string;
  sourceId: string;
  sourceType: string;
  chunkIndex: number;
  chunkHash: string;
  providerId: string;
  vector: number[];
  createdAt: string;
}

export interface EmbeddingCoverage {
  /** Total source rows (notes + entities + scenes). */
  sourcesTotal: number;
  /** Sources with at least one embedding in the current provider. */
  sourcesEmbedded: number;
  /** Total chunks stored for this provider. */
  chunksTotal: number;
  /** Coverage % (0–100). */
  coveragePct: number;
}

interface Row {
  id: string;
  source_id: string;
  source_type: string;
  chunk_index: number;
  chunk_hash: string;
  provider_id: string;
  vector: string;
  created_at: string;
}

function toEmbeddingRow(row: Row): EmbeddingRow {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceType: row.source_type,
    chunkIndex: row.chunk_index,
    chunkHash: row.chunk_hash,
    providerId: row.provider_id,
    vector: JSON.parse(row.vector) as number[],
    createdAt: row.created_at,
  };
}

export function embeddingsRepo(db: Db) {
  return {
    /**
     * Upsert one embedding. If (chunk_hash, provider_id) already exists, skip.
     * Returns true if a new row was inserted.
     */
    upsert(input: Omit<EmbeddingRow, 'id' | 'createdAt'>): boolean {
      const existing = db
        .prepare(
          `SELECT id FROM embeddings WHERE chunk_hash = ? AND provider_id = ? LIMIT 1`,
        )
        .get(input.chunkHash, input.providerId);
      if (existing) return false;

      const id = `emb_${randomUUID().replace(/-/g, '')}`;
      db.prepare(
        `INSERT INTO embeddings (id, source_id, source_type, chunk_index, chunk_hash, provider_id, vector)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.sourceId,
        input.sourceType,
        input.chunkIndex,
        input.chunkHash,
        input.providerId,
        JSON.stringify(input.vector),
      );
      return true;
    },

    /** Delete all embeddings for a source (called before re-embedding on edit). */
    deleteBySource(sourceId: string, sourceType: string, providerId: string): number {
      const result = db
        .prepare(
          `DELETE FROM embeddings WHERE source_id = ? AND source_type = ? AND provider_id = ?`,
        )
        .run(sourceId, sourceType, providerId);
      return result.changes;
    },

    /** All embeddings for a provider, ordered by source_id + chunk_index. */
    listByProvider(providerId: string): EmbeddingRow[] {
      const rows = db
        .prepare(
          `SELECT * FROM embeddings WHERE provider_id = ? ORDER BY source_id, chunk_index`,
        )
        .all(providerId) as Row[];
      return rows.map(toEmbeddingRow);
    },

    /** All embeddings for a specific source (for re-embed / inspect). */
    listBySource(sourceId: string, sourceType: string, providerId: string): EmbeddingRow[] {
      const rows = db
        .prepare(
          `SELECT * FROM embeddings
           WHERE source_id = ? AND source_type = ? AND provider_id = ?
           ORDER BY chunk_index`,
        )
        .all(sourceId, sourceType, providerId) as Row[];
      return rows.map(toEmbeddingRow);
    },

    /**
     * Coverage stats for a given provider.
     * "covered" = at least one chunk embedded.
     */
    coverage(providerId: string): EmbeddingCoverage {
      const notes = (
        db.prepare(`SELECT COUNT(*) AS n FROM notes WHERE trashed_at IS NULL`).get() as { n: number }
      ).n;
      const entities = (
        db.prepare(`SELECT COUNT(*) AS n FROM entities`).get() as { n: number }
      ).n;
      const scenes = (
        db.prepare(`SELECT COUNT(*) AS n FROM scenes`).get() as { n: number }
      ).n;
      const sourcesTotal = notes + entities + scenes;

      const sourcesEmbedded = (
        db
          .prepare(
            `SELECT COUNT(DISTINCT source_id) AS n FROM embeddings WHERE provider_id = ?`,
          )
          .get(providerId) as { n: number }
      ).n;

      const chunksTotal = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM embeddings WHERE provider_id = ?`)
          .get(providerId) as { n: number }
      ).n;

      const coveragePct =
        sourcesTotal === 0 ? 0 : Math.round((sourcesEmbedded / sourcesTotal) * 100);

      return { sourcesTotal, sourcesEmbedded, chunksTotal, coveragePct };
    },

    /** Delete all embeddings for a provider (model-swap path). */
    deleteAllForProvider(providerId: string): number {
      const result = db
        .prepare(`DELETE FROM embeddings WHERE provider_id = ?`)
        .run(providerId);
      return result.changes;
    },

    /** Total chunk count across all providers. */
    totalChunks(): number {
      return (db.prepare(`SELECT COUNT(*) AS n FROM embeddings`).get() as { n: number }).n;
    },
  };
}

export type EmbeddingsRepo = ReturnType<typeof embeddingsRepo>;
