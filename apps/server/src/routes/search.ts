import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { searchRepo, type SearchType } from '../db/repos/search.js';

/**
 * Search routes (F701–F710):
 *   GET  /search            — keyword FTS5 search with grouped results
 *   POST /search/rebuild    — rebuild all FTS tables from source
 *   GET  /search/consistency — FTS row counts vs source counts
 */

const ALL_TYPES: SearchType[] = ['notes', 'entities', 'stories'];

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  types: z.string().optional(), // comma-separated subset of SearchType
  limit: z.coerce.number().int().min(1).max(200).default(20),
  cursor: z.string().optional(), // kept for API shape consistency; not used in FTS grouping
});

registerRoute({
  method: 'GET',
  path: '/search',
  summary: 'FTS5 keyword search with grouped results (notes, entities, stories)',
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
   * GET /search?q=&types=notes,entities,stories&limit=20&cursor=
   *
   * Response:
   * {
   *   data: {
   *     mode: 'keyword',
   *     query: string,
   *     groups: [{ type, total, results: [{ id, title, snippet, highlights, score }] }]
   *   },
   *   page: { nextCursor: null, limit: number }
   * }
   */
  app.get('/search', async (request) => {
    const { q, types: typesRaw, limit, cursor } = parseWith(
      searchQuerySchema,
      request.query,
      'query',
    );
    const types = parseTypes(typesRaw);
    const repo = searchRepo(app.db);

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
      data: {
        mode: 'keyword',
        query: q,
        groups,
      },
      page: {
        nextCursor: cursor ?? null,
        limit,
      },
    };
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
