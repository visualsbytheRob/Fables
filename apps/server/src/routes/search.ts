import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { searchRepo, type SearchType } from '../db/repos/search.js';
import { hybridFuse, type RRFInput } from '../intelligence/hybrid-rank.js';

/**
 * Search routes (F701–F710, F741–F750):
 *   GET  /search            — keyword (default) / semantic / hybrid FTS5+vector search
 *   POST /search/rebuild    — rebuild all FTS tables from source
 *   GET  /search/consistency — FTS row counts vs source counts
 *   GET  /search/semantic   — pure vector search (F731–F734)
 *   GET  /search/duplicates — near-duplicate detection (F738)
 *
 * mode=keyword (default): FTS5 only — behaviour unchanged from F701–F710.
 * mode=semantic: vector search only.
 * mode=hybrid: RRF fusion of FTS + vector, with recency/link/type boosts (F741–F750).
 *
 * Fallback chain (F749): when embeddings unavailable, hybrid/semantic → keyword
 * with degraded:true in the response.
 */

const ALL_TYPES: SearchType[] = ['notes', 'entities', 'stories'];

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  types: z.string().optional(), // comma-separated subset of SearchType
  limit: z.coerce.number().int().min(1).max(200).default(20),
  cursor: z.string().optional(),
  mode: z.enum(['keyword', 'semantic', 'hybrid']).default('keyword'),
  notebook: z.string().optional(),
  explain: z.coerce.boolean().default(false),
});

const semanticQuerySchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  types: z.string().optional(),
  notebook: z.string().optional(),
});

const duplicatesQuerySchema = z.object({
  threshold: z.coerce.number().min(0).max(1).default(0.92),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

registerRoute({
  method: 'GET',
  path: '/search',
  summary:
    'FTS5 keyword / semantic / hybrid search (mode=keyword|semantic|hybrid)',
  query: searchQuerySchema,
});
registerRoute({
  method: 'POST',
  path: '/search/rebuild',
  summary: 'Rebuild all FTS5 indexes from source tables',
});
registerRoute({
  method: 'GET',
  path: '/search/consistency',
  summary: 'FTS row counts vs source table counts',
});
registerRoute({
  method: 'GET',
  path: '/search/semantic',
  summary: 'Pure vector semantic search',
  query: semanticQuerySchema,
});
registerRoute({
  method: 'GET',
  path: '/search/duplicates',
  summary: 'Near-duplicate note detection via embedding similarity',
  query: duplicatesQuerySchema,
});

function parseTypes(raw: string | undefined): SearchType[] {
  if (raw === undefined || raw.trim() === '') return ALL_TYPES;
  const parts = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return parts.filter((p): p is SearchType => ALL_TYPES.includes(p as SearchType));
}

export const searchRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /search?q=&types=notes,entities,stories&limit=20&mode=keyword|semantic|hybrid
   *
   * mode=keyword: classic FTS5 grouped results (unchanged from F701–F710).
   * mode=semantic: vector results only (falls back to keyword if embeddings empty).
   * mode=hybrid: RRF fusion (falls back to keyword if embeddings empty).
   *
   * Response shape for keyword mode:
   *   { data: { mode, query, groups: [{type, total, results}] }, page }
   *
   * Response shape for semantic/hybrid:
   *   { data: { mode, query, degraded?, results: [{id, title, score, snippet, ...}] }, page }
   */
  app.get('/search', async (request) => {
    const { q, types: typesRaw, limit, cursor, mode, notebook, explain } = parseWith(
      searchQuerySchema,
      request.query,
      'query',
    );
    const types = parseTypes(typesRaw);
    const repo = searchRepo(app.db);
    const store = app.intel.store;

    // ── keyword mode (default, unchanged) ───────────────────────────────────
    if (mode === 'keyword') {
      const groups = types.map((type) => {
        if (type === 'notes') {
          return {
            type: 'notes' as SearchType,
            total: repo.countNotes(q),
            results: repo.searchNotes(q, limit),
          };
        } else if (type === 'entities') {
          return {
            type: 'entities' as SearchType,
            total: repo.countEntities(q),
            results: repo.searchEntities(q, limit),
          };
        } else {
          return {
            type: 'stories' as SearchType,
            total: repo.countStories(q),
            results: repo.searchStories(q, limit),
          };
        }
      });
      return {
        data: { mode: 'keyword', query: q, groups },
        page: { nextCursor: cursor ?? null, limit },
      };
    }

    // ── semantic / hybrid modes ──────────────────────────────────────────────
    // Check embedding availability — fall back to keyword if empty
    const { embeddingsRepo } = await import('../db/repos/embeddings.js');
    const embRepo = embeddingsRepo(app.db);
    const hasEmbeddings = embRepo.totalChunks() > 0;

    if (!hasEmbeddings) {
      // Graceful degradation (F749): return keyword results with degraded:true
      const groups = types.map((type) => {
        if (type === 'notes') {
          return {
            type: 'notes' as SearchType,
            total: repo.countNotes(q),
            results: repo.searchNotes(q, limit),
          };
        } else if (type === 'entities') {
          return {
            type: 'entities' as SearchType,
            total: repo.countEntities(q),
            results: repo.searchEntities(q, limit),
          };
        } else {
          return {
            type: 'stories' as SearchType,
            total: repo.countStories(q),
            results: repo.searchStories(q, limit),
          };
        }
      });
      return {
        data: { mode, query: q, degraded: true, groups },
        page: { nextCursor: cursor ?? null, limit },
      };
    }

    if (mode === 'semantic') {
      const typeFilter: string[] | undefined = types.includes('notes') ? undefined : [...types];
      const results = await store.search(q, {
        limit,
        ...(typeFilter !== undefined ? { types: typeFilter } : {}),
        ...(notebook !== undefined ? { notebookId: notebook } : {}),
      });
      return {
        data: { mode: 'semantic', query: q, degraded: false, results },
        page: { nextCursor: null, limit },
      };
    }

    // ── hybrid mode ──────────────────────────────────────────────────────────
    // Get FTS results (as flat list for RRF)
    const ftsNotes = types.includes('notes') ? repo.searchNotes(q, limit) : [];
    const ftsEntities = types.includes('entities') ? repo.searchEntities(q, limit) : [];
    const ftsStories = types.includes('stories') ? repo.searchStories(q, limit) : [];

    const ftsAll: RRFInput[] = [
      ...ftsNotes.map((r) => ({ ...r, sourceType: 'note' as const, updatedAt: getUpdatedAt(app.db, r.id, 'note'), linkDegree: getLinkDegree(app.db, r.id) })),
      ...ftsEntities.map((r) => ({ ...r, sourceType: 'entity' as const })),
      ...ftsStories.map((r) => ({ ...r, sourceType: 'scene' as const })),
    ];

    // Get vector results
    const vectorTypeFilter: string[] | undefined = types.includes('notes') ? undefined : [...types];
    const vectorResults = await store.search(q, {
      limit,
      ...(vectorTypeFilter !== undefined ? { types: vectorTypeFilter } : {}),
      ...(notebook !== undefined ? { notebookId: notebook } : {}),
    });

    const vectorRRF: RRFInput[] = vectorResults.map((r) => ({
      id: r.id,
      title: r.title,
      score: r.score,
      snippet: r.snippet,
      highlights: [],
      sourceType: r.sourceType,
      updatedAt: r.sourceType === 'note' ? getUpdatedAt(app.db, r.id, 'note') : undefined,
      linkDegree: r.sourceType === 'note' ? getLinkDegree(app.db, r.id) : 0,
    }));

    // Max link degree for normalisation
    const maxDegree = Math.max(
      0,
      ...ftsAll.map((r) => r.linkDegree ?? 0),
      ...vectorRRF.map((r) => r.linkDegree ?? 0),
    );

    const ranked = hybridFuse(ftsAll, vectorRRF, q, maxDegree, explain);
    const results = ranked.slice(0, limit);

    return {
      data: { mode: 'hybrid', query: q, degraded: false, results },
      page: { nextCursor: null, limit },
    };
  });

  /**
   * GET /search/semantic — pure vector search endpoint (F732).
   *
   * Response:
   * {
   *   data: {
   *     mode: 'semantic',
   *     query: string,
   *     degraded: boolean,
   *     results: [{ id, title, sourceType, score, snippet, chunkIndex }]
   *   }
   * }
   */
  app.get('/search/semantic', async (request) => {
    const { q, limit, types: typesRaw, notebook } = parseWith(
      semanticQuerySchema,
      request.query,
      'query',
    );

    const { embeddingsRepo } = await import('../db/repos/embeddings.js');
    const embRepo = embeddingsRepo(app.db);
    const hasEmbeddings = embRepo.totalChunks() > 0;

    if (!hasEmbeddings) {
      // Graceful degradation: return keyword notes results
      const repo = searchRepo(app.db);
      const keywordResults = repo.searchNotes(q, limit);
      return {
        data: {
          mode: 'semantic',
          query: q,
          degraded: true,
          results: keywordResults.map((r) => ({
            id: r.id,
            title: r.title,
            sourceType: 'note',
            score: 0.5,
            snippet: r.snippet,
            chunkIndex: 0,
          })),
        },
      };
    }

    const parsedTypes: string[] | undefined = typesRaw
      ? typesRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;

    const results = await app.intel.store.search(q, {
      limit,
      ...(parsedTypes !== undefined ? { types: parsedTypes } : {}),
      ...(notebook !== undefined ? { notebookId: notebook } : {}),
    });
    return {
      data: { mode: 'semantic', query: q, degraded: false, results },
    };
  });

  /**
   * GET /search/duplicates — near-duplicate note pairs (F738).
   */
  app.get('/search/duplicates', async (request) => {
    const { threshold, limit } = parseWith(duplicatesQuerySchema, request.query, 'query');
    const { embeddingsRepo } = await import('../db/repos/embeddings.js');
    const hasEmbeddings = embeddingsRepo(app.db).totalChunks() > 0;
    if (!hasEmbeddings) {
      return { data: { degraded: true, pairs: [] } };
    }
    const pairs = await app.intel.store.nearDuplicates(threshold, limit);
    // Enrich with titles
    const enriched = pairs.map((p) => {
      const a = app.db
        .prepare(`SELECT title FROM notes WHERE id = ?`)
        .get(p.a) as { title: string } | undefined;
      const b = app.db
        .prepare(`SELECT title FROM notes WHERE id = ?`)
        .get(p.b) as { title: string } | undefined;
      return { ...p, titleA: a?.title ?? '', titleB: b?.title ?? '' };
    });
    return { data: { degraded: false, pairs: enriched } };
  });

  /** POST /search/rebuild */
  app.post('/search/rebuild', async (_request, reply) => {
    searchRepo(app.db).rebuildAll();
    reply.status(200);
    return { data: { rebuilt: true } };
  });

  /** GET /search/consistency */
  app.get('/search/consistency', async () => {
    const repo = searchRepo(app.db);
    const fts = repo.ftsCounts();
    const source = repo.sourceCounts();
    return {
      data: {
        notes: { fts: fts.notes, source: source.notes, ok: fts.notes === source.notes },
        entities: {
          fts: fts.entities,
          source: source.entities,
          ok: fts.entities === source.entities,
        },
        scenes: { fts: fts.scenes, source: source.scenes, ok: fts.scenes === source.scenes },
      },
    };
  });
};

// ── Helpers ────────────────────────────────────────────────────────────────────

import type { Db } from '../db/connection.js';

function getUpdatedAt(db: Db, id: string, type: string): string | undefined {
  if (type !== 'note') return undefined;
  try {
    const row = db
      .prepare(`SELECT updated_at FROM notes WHERE id = ?`)
      .get(id) as { updated_at: string } | undefined;
    return row?.updated_at;
  } catch {
    return undefined;
  }
}

function getLinkDegree(db: Db, noteId: string): number {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM links
         WHERE kind = 'wikilink'
           AND ((source_type = 'note' AND source_id = ?)
             OR (target_type = 'note' AND target_id = ?))`,
      )
      .get(noteId, noteId) as { n: number };
    return row.n;
  } catch {
    return 0;
  }
}
