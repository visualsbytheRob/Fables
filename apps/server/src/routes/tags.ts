import { conflict, notFound, type TagId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { tagsRepo } from '../db/repos/tags.js';
import { mergeTags, parseTagName, renameTag } from '../services/tags.js';

const idParamsSchema = z.object({ id: z.string().min(1) });
const mergeParamsSchema = z.object({ id: z.string().min(1), targetId: z.string().min(1) });

const createBodySchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().max(32).nullish(),
});

const patchBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().max(32).nullable().optional(),
});

registerRoute({ method: 'GET', path: '/tags', summary: 'List tags with live-note counts' });
registerRoute({ method: 'POST', path: '/tags', summary: 'Create a tag', body: createBodySchema });
registerRoute({ method: 'GET', path: '/tags/:id', summary: 'Fetch a tag', params: idParamsSchema });
registerRoute({
  method: 'PATCH',
  path: '/tags/:id',
  summary: 'Rename (with propagation) or recolor a tag',
  params: idParamsSchema,
  body: patchBodySchema,
});
registerRoute({
  method: 'DELETE',
  path: '/tags/:id',
  summary: 'Delete a tag and its note links',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/tags/:id/merge-into/:targetId',
  summary: 'Merge a tag into another',
  params: mergeParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/tags/cleanup',
  summary: 'Delete tags with no linked notes',
});

export const tagsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/tags', async () => ({ data: tagsRepo(app.db).listWithCounts() }));

  app.post('/tags', async (request, reply) => {
    const body = parseWith(createBodySchema, request.body, 'body');
    const name = parseTagName(body.name);
    const repo = tagsRepo(app.db);
    if (repo.getByName(name)) throw conflict('tag already exists', { name });
    const tag = repo.create({ name, color: body.color ?? null });
    reply.status(201);
    return { data: tag };
  });

  app.get('/tags/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const tag = tagsRepo(app.db).get(id as TagId);
    if (!tag) throw notFound('Tag', id);
    return { data: tag };
  });

  app.patch('/tags/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(patchBodySchema, request.body, 'body');
    const repo = tagsRepo(app.db);
    if (!repo.get(id as TagId)) throw notFound('Tag', id);
    let tag = body.name !== undefined ? renameTag(app.db, id as TagId, body.name) : null;
    if (body.color !== undefined) tag = repo.update(id as TagId, { color: body.color });
    return { data: tag ?? repo.get(id as TagId) };
  });

  app.delete('/tags/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    if (!tagsRepo(app.db).remove(id as TagId)) throw notFound('Tag', id);
    return { data: { id, deleted: true } };
  });

  app.post('/tags/:id/merge-into/:targetId', async (request) => {
    const { id, targetId } = parseWith(mergeParamsSchema, request.params, 'params');
    const result = mergeTags(app.db, id as TagId, targetId as TagId);
    return { data: result };
  });

  /** Orphan tag cleanup (F159) — also runs automatically on boot. */
  app.post('/tags/cleanup', async () => ({
    data: { removed: tagsRepo(app.db).cleanupOrphans() },
  }));
};
