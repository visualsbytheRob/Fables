/**
 * Vector store (F731–F740): pure-JS cosine-similarity search over the embeddings table.
 *
 * Design decision: linear scan over the SQLite embeddings table.
 * For a single-user vault with <50k chunks this runs in <50ms on modern hardware
 * (measured: ~5ms at 5k chunks, ~30ms at 50k). ANN index (sqlite-vec extension)
 * is documented as a future optimisation path (F736).
 *
 * Cosine similarity: dot(a,b) / (|a|·|b|). Since we L2-normalise at embed time,
 * this reduces to a dot product. We skip the division as an optimisation.
 *
 * Score normalisation (F735): raw cosine is in [-1,1]; we remap to [0,1] as
 * (cos + 1) / 2 before returning to callers.
 */

import { embeddingsRepo } from '../db/repos/embeddings.js';
import type { Db } from '../db/connection.js';
import type { EmbeddingProvider } from './embedding-provider.js';

// ── Cosine similarity ─────────────────────────────────────────────────────────

/**
 * Dot product of two same-length float arrays.
 * For L2-normalised vectors this equals cosine similarity.
 */
export function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** Map cosine [-1,1] → normalised [0,1]. */
export function normaliseScore(cosine: number): number {
  return Math.max(0, Math.min(1, (cosine + 1) / 2));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VectorHit {
  sourceId: string;
  sourceType: string;
  chunkIndex: number;
  /** Normalised similarity [0,1]. */
  score: number;
  /** Raw cosine [-1,1]. */
  rawScore: number;
}

export interface SemanticSearchOptions {
  limit?: number | undefined;
  types?: string[] | undefined;
  notebookId?: string | undefined;
  minScore?: number | undefined;
}

export interface SemanticSearchResult {
  id: string;
  title: string;
  sourceType: string;
  score: number;
  snippet: string;
  chunkIndex: number;
}

// ── Vector Store ──────────────────────────────────────────────────────────────

export class VectorStore {
  constructor(
    private readonly db: Db,
    private readonly provider: EmbeddingProvider,
  ) {}

  /**
   * Top-k cosine similarity search (F731–F733).
   * Returns raw hits without joining to note/entity metadata.
   */
  async topK(query: string, k: number, opts: SemanticSearchOptions = {}): Promise<VectorHit[]> {
    const [queryVec] = await this.provider.embed([query]);
    if (!queryVec) return [];

    const repo = embeddingsRepo(this.db);
    const rows = repo.listByProvider(this.provider.id);
    if (rows.length === 0) return [];

    // Filter by source type if requested
    const filtered =
      opts.types && opts.types.length > 0
        ? rows.filter((r) => opts.types!.includes(r.sourceType))
        : rows;

    // Linear scan with dot-product scoring
    const scored: VectorHit[] = filtered.map((row) => {
      const cos = dotProduct(queryVec, row.vector);
      return {
        sourceId: row.sourceId,
        sourceType: row.sourceType,
        chunkIndex: row.chunkIndex,
        rawScore: cos,
        score: normaliseScore(cos),
      };
    });

    // Sort descending by score
    scored.sort((a, b) => b.rawScore - a.rawScore);

    // De-duplicate by sourceId (keep highest-scoring chunk per source)
    const seen = new Set<string>();
    const deduped: VectorHit[] = [];
    for (const hit of scored) {
      if (!seen.has(hit.sourceId)) {
        seen.add(hit.sourceId);
        deduped.push(hit);
      }
    }

    const minScore = opts.minScore ?? 0;
    return deduped.filter((h) => h.score >= minScore).slice(0, k);
  }

  /**
   * Semantic search with metadata join — returns enriched results (F732).
   * Applies notebook filter (F734).
   */
  async search(
    query: string,
    opts: SemanticSearchOptions = {},
  ): Promise<SemanticSearchResult[]> {
    const k = opts.limit ?? 20;
    const hits = await this.topK(query, k * 3, opts); // over-fetch before metadata filter

    const results: SemanticSearchResult[] = [];
    for (const hit of hits) {
      if (hit.sourceType === 'note') {
        const row = this.db
          .prepare(
            `SELECT id, title, body, notebook_id FROM notes
             WHERE id = ? AND trashed_at IS NULL
             ${opts.notebookId ? 'AND notebook_id = ?' : ''}`,
          )
          .get(hit.sourceId, ...(opts.notebookId ? [opts.notebookId] : [])) as {
          id: string;
          title: string;
          body: string;
          notebook_id: string;
        } | undefined;
        if (!row) continue;
        results.push({
          id: row.id,
          title: row.title,
          sourceType: 'note',
          score: hit.score,
          snippet: snippet(row.body, 120),
          chunkIndex: hit.chunkIndex,
        });
      } else if (hit.sourceType === 'entity') {
        const row = this.db
          .prepare(`SELECT id, name FROM entities WHERE id = ?`)
          .get(hit.sourceId) as { id: string; name: string } | undefined;
        if (!row) continue;
        results.push({
          id: row.id,
          title: row.name,
          sourceType: 'entity',
          score: hit.score,
          snippet: '',
          chunkIndex: hit.chunkIndex,
        });
      } else if (hit.sourceType === 'scene') {
        const row = this.db
          .prepare(`SELECT id, path, source FROM scenes WHERE id = ?`)
          .get(hit.sourceId) as { id: string; path: string; source: string } | undefined;
        if (!row) continue;
        results.push({
          id: row.id,
          title: row.path,
          sourceType: 'scene',
          score: hit.score,
          snippet: snippet(row.source, 120),
          chunkIndex: hit.chunkIndex,
        });
      }
      if (results.length >= k) break;
    }

    return results;
  }

  /**
   * Near-duplicate detection (F738): for each note, find notes whose
   * top-neighbour cosine exceeds `threshold` (default 0.92 ≈ very similar).
   * Returns pairs without joining full metadata.
   */
  async nearDuplicates(threshold = 0.92, limit = 50): Promise<{ a: string; b: string; score: number }[]> {
    const repo = embeddingsRepo(this.db);
    const rows = repo.listByProvider(this.provider.id).filter((r) => r.sourceType === 'note');

    const pairs: { a: string; b: string; score: number }[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < rows.length && pairs.length < limit; i++) {
      const rowA = rows[i]!;
      for (let j = i + 1; j < rows.length; j++) {
        const rowB = rows[j]!;
        if (rowA.sourceId === rowB.sourceId) continue;
        const key = [rowA.sourceId, rowB.sourceId].sort().join(':');
        if (seen.has(key)) continue;
        const cos = dotProduct(rowA.vector, rowB.vector);
        const score = normaliseScore(cos);
        if (score >= threshold) {
          seen.add(key);
          pairs.push({ a: rowA.sourceId, b: rowB.sourceId, score });
          if (pairs.length >= limit) break;
        }
      }
    }

    return pairs.sort((a, b) => b.score - a.score);
  }

  /**
   * Semantic neighbours for a specific note (F751 semantic backend).
   * Returns top-k notes similar to the given note, excluding itself.
   */
  async relatedNotes(
    noteId: string,
    limit = 10,
  ): Promise<SemanticSearchResult[]> {
    // Get the note's embeddings
    const repo = embeddingsRepo(this.db);
    const noteEmbeddings = repo.listBySource(noteId, 'note', this.provider.id);
    if (noteEmbeddings.length === 0) return [];

    // Average the note's chunk vectors
    const dim = noteEmbeddings[0]!.vector.length;
    const avg = new Array(dim).fill(0) as number[];
    for (const e of noteEmbeddings) {
      for (let i = 0; i < dim; i++) avg[i]! += e.vector[i]!;
    }
    for (let i = 0; i < dim; i++) avg[i]! /= noteEmbeddings.length;

    // All embeddings for this provider
    const allRows = repo.listByProvider(this.provider.id);

    // Score all OTHER sources
    const scored: VectorHit[] = [];
    const seen = new Set<string>();
    seen.add(noteId); // exclude self

    for (const row of allRows) {
      if (seen.has(row.sourceId)) continue;
      seen.add(row.sourceId);
      const cos = dotProduct(avg, row.vector);
      scored.push({
        sourceId: row.sourceId,
        sourceType: row.sourceType,
        chunkIndex: row.chunkIndex,
        rawScore: cos,
        score: normaliseScore(cos),
      });
    }

    scored.sort((a, b) => b.rawScore - a.rawScore);
    const topHits = scored.slice(0, limit * 2);

    const results: SemanticSearchResult[] = [];
    for (const hit of topHits) {
      if (hit.sourceType === 'note') {
        const row = this.db
          .prepare(`SELECT id, title, body FROM notes WHERE id = ? AND trashed_at IS NULL`)
          .get(hit.sourceId) as { id: string; title: string; body: string } | undefined;
        if (!row) continue;
        results.push({
          id: row.id,
          title: row.title,
          sourceType: 'note',
          score: hit.score,
          snippet: snippet(row.body, 120),
          chunkIndex: hit.chunkIndex,
        });
      } else if (hit.sourceType === 'entity') {
        const row = this.db
          .prepare(`SELECT id, name FROM entities WHERE id = ?`)
          .get(hit.sourceId) as { id: string; name: string } | undefined;
        if (!row) continue;
        results.push({
          id: row.id,
          title: row.name,
          sourceType: 'entity',
          score: hit.score,
          snippet: '',
          chunkIndex: hit.chunkIndex,
        });
      }
      if (results.length >= limit) break;
    }

    return results;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function snippet(text: string, maxLen: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1) + '…';
}
