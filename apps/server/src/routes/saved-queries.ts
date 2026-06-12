import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { paginated, parsePagination } from '../api/envelope.js';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { savedQueriesRepo } from '../db/repos/saved-queries.js';
import { parseFql } from '../fql/index.js';
import { runFqlQuery } from '../services/query.js';

/**
 * Saved queries (F281, F287): named FQL strings the sidebar shows as smart
 * folders. The FQL is validated (parse only) on create/update; execution
 * happens via /saved-queries/:id/results with the standard note pagination.
 * Embed depth/recursion guards are a web-side concern (F289).
 */

const idParamsSchema = z.object({ id: z.string().min(1) });

const createBodySchema = z.object({
  name: z.string().min(1).max(200),
  fql: z.string().max(2000),
  icon: z.string().max(64).nullish(),
  pinned: z.boolean().default(false),
});

const patchBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  fql: z.string().max(2000).optional(),
  icon: z.string().max(64).nullable().optional(),
  pinned: z.boolean().optional(),
});

registerRoute({
  method: 'POST',
  path: '/saved-queries',
  summary: 'Create a saved query (FQL validated)',
  body: createBodySchema,
});
registerRoute({ method: 'GET', path: '/saved-queries', summary: 'List saved queries' });
registerRoute({
  method: 'GET',
  path: '/saved-queries/:id',
  summary: 'Fetch a saved query',
  params: idParamsSchema,
});
registerRoute({
  method: 'PATCH',
  path: '/saved-queries/:id',
  summary: 'Update a saved query',
  params: idParamsSchema,
  body: patchBodySchema,
});
registerRoute({
  method: 'DELETE',
  path: '/saved-queries/:id',
  summary: 'Delete a saved query',
  params: idParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/saved-queries/:id/results',
  summary: 'Run a saved query (paginated note results + warnings)',
  params: idParamsSchema,
});

export const savedQueriesRoutes: FastifyPluginAsync = async (app) => {
  app.post('/saved-queries', async (request, reply) => {
    const body = parseWith(createBodySchema, request.body, 'body');
    parseFql(body.fql); // reject queries that can't even partially parse
    const saved = savedQueriesRepo(app.db).create({
      name: body.name,
      fql: body.fql,
      icon: body.icon ?? null,
      pinned: body.pinned,
    });
    reply.status(201);
    return { data: saved };
  });

  app.get('/saved-queries', async () => ({ data: savedQueriesRepo(app.db).list() }));

  app.get('/saved-queries/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const saved = savedQueriesRepo(app.db).get(id);
    if (!saved) throw notFound('Saved query', id);
    return { data: saved };
  });

  app.patch('/saved-queries/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(patchBodySchema, request.body, 'body');
    if (body.fql !== undefined) parseFql(body.fql);
    const saved = savedQueriesRepo(app.db).update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.fql !== undefined ? { fql: body.fql } : {}),
      ...(body.icon !== undefined ? { icon: body.icon } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
    });
    return { data: saved };
  });

  app.delete('/saved-queries/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    if (!savedQueriesRepo(app.db).remove(id)) throw notFound('Saved query', id);
    return { data: { id, deleted: true } };
  });

  app.get('/saved-queries/:id/results', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const saved = savedQueriesRepo(app.db).get(id);
    if (!saved) throw notFound('Saved query', id);
    const pagination = parsePagination(request.query);
    const { notes, warnings } = runFqlQuery(app.db, saved.fql, {
      fetch: pagination.limit + 1,
      cursor: pagination.cursor,
    });
    return { ...paginated(notes, pagination), warnings };
  });
};
