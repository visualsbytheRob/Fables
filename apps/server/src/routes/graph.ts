import { validation, type NotebookId, type NoteId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import type { LinkKind } from '../db/repos/links.js';
import {
  buildGraph,
  GRAPH_KINDS,
  localGraph,
  toGraphML,
  type GraphFilter,
} from '../services/graph.js';

const filterQuerySchema = z.object({
  notebookId: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  /** Comma-separated link kinds; defaults to `wikilink`. */
  kinds: z.string().min(1).optional(),
  /** ISO timestamp; only notes updated at/after it. */
  since: z.string().min(1).optional(),
});

const exportQuerySchema = filterQuerySchema.extend({
  format: z.enum(['json', 'graphml']).default('json'),
});

const localQuerySchema = filterQuerySchema.extend({
  hops: z.coerce.number().int().min(1).max(3).default(1),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

registerRoute({
  method: 'GET',
  path: '/graph',
  summary: 'Full note graph: nodes + weighted edges with filters',
  query: filterQuerySchema,
});
registerRoute({
  method: 'GET',
  path: '/graph/export',
  summary: 'Download the graph as JSON or GraphML',
  query: exportQuerySchema,
});
registerRoute({
  method: 'GET',
  path: '/notes/:id/graph',
  summary: 'Local n-hop neighborhood graph around one note',
  params: idParamsSchema,
  query: localQuerySchema,
});
registerRoute({
  method: 'GET',
  path: '/graph/presets',
  summary: 'Named graph filter presets (story web, knowledge web, fusion view)',
});

/** Graph filter presets (F667): named kind-sets the UI offers as one-tap views. */
export const GRAPH_PRESETS = [
  { id: 'wikilinks', label: 'Wikilinks', kinds: ['wikilink'] },
  { id: 'knowledge-web', label: 'Knowledge web', kinds: ['wikilink', 'mention'] },
  { id: 'story-web', label: 'Story web', kinds: ['binding', 'relation'] },
  { id: 'fusion-view', label: 'Fusion view', kinds: ['wikilink', 'mention', 'binding', 'relation'] },
] as const;

function parseFilter(query: z.infer<typeof filterQuerySchema>): GraphFilter {
  let kinds: LinkKind[] | undefined;
  if (query.kinds !== undefined) {
    const parsed = query.kinds.split(',').map((k) => k.trim());
    const invalid = parsed.filter((k) => !GRAPH_KINDS.includes(k as LinkKind));
    if (invalid.length > 0) {
      throw validation('unknown link kinds', { invalid, allowed: GRAPH_KINDS });
    }
    kinds = parsed as LinkKind[];
  }
  return {
    ...(query.notebookId !== undefined ? { notebookId: query.notebookId as NotebookId } : {}),
    ...(query.tag !== undefined ? { tag: query.tag } : {}),
    ...(kinds !== undefined ? { kinds } : {}),
    ...(query.since !== undefined ? { since: query.since } : {}),
  };
}

export const graphRoutes: FastifyPluginAsync = async (app) => {
  app.get('/graph', async (request) => {
    const query = parseWith(filterQuerySchema, request.query, 'query');
    return { data: buildGraph(app.db, parseFilter(query)) };
  });

  app.get('/graph/export', async (request, reply) => {
    const query = parseWith(exportQuerySchema, request.query, 'query');
    const graph = buildGraph(app.db, parseFilter(query));
    if (query.format === 'graphml') {
      reply
        .type('application/graphml+xml')
        .header('content-disposition', 'attachment; filename="fables-graph.graphml"');
      return toGraphML(graph);
    }
    reply.header('content-disposition', 'attachment; filename="fables-graph.json"');
    return { data: graph };
  });

  app.get('/notes/:id/graph', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const query = parseWith(localQuerySchema, request.query, 'query');
    return { data: localGraph(app.db, id as NoteId, query.hops, parseFilter(query)) };
  });

  app.get('/graph/presets', async () => {
    return { data: GRAPH_PRESETS };
  });
};
