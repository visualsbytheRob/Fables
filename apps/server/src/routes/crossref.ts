import { type EntityId, type NoteId, type StoryId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { recompileStory } from '../stories/service.js';
import {
  entityImpact,
  incomingRefs,
  noteImpact,
  rebindEntity,
  storyDependencies,
} from '../services/crossref.js';

/**
 * Cross-reference browser (F661–F670): incoming references, story dependency
 * reports, knowledge impact reports, and the batch re-bind tool.
 */

const idParamsSchema = z.object({ id: z.string().min(1) });
const refParamsSchema = z.object({
  type: z.enum(['note', 'entity', 'story']),
  id: z.string().min(1),
});
const rebindBodySchema = z.object({ to: z.string().min(1).max(200) });

registerRoute({
  method: 'GET',
  path: '/refs/:type/:id',
  summary: 'Incoming references to a note/entity/story, grouped by kind',
  params: refParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/dependencies',
  summary: 'Everything a story reads/writes (bindings + declared entities)',
  params: idParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/notes/:id/impact',
  summary: 'Which stories reference this note and which builds would break',
  params: idParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/entities/:id/impact',
  summary: 'Which stories reference this entity and which builds would break',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/entities/:id/rebind',
  summary: 'Re-bind every reference of this entity to another, recompiling stories',
  params: idParamsSchema,
  body: rebindBodySchema,
});

export const crossrefRoutes: FastifyPluginAsync = async (app) => {
  app.get('/refs/:type/:id', async (request) => {
    const { type, id } = parseWith(refParamsSchema, request.params, 'params');
    return { data: incomingRefs(app.db, type, id) };
  });

  app.get('/stories/:id/dependencies', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    return { data: storyDependencies(app.db, id as StoryId) };
  });

  app.get('/notes/:id/impact', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    return { data: noteImpact(app.db, id as NoteId) };
  });

  app.get('/entities/:id/impact', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    return { data: entityImpact(app.db, id as EntityId) };
  });

  app.post('/entities/:id/rebind', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(rebindBodySchema, request.body, 'body');
    const result = rebindEntity(app.db, id as EntityId, body.to, (storyId) =>
      recompileStory(app.db, storyId),
    );
    return { data: result };
  });
};
