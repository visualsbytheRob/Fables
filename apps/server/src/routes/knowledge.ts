import type { StoryId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { playthroughsRepo } from '../db/repos/playthroughs.js';
import { storiesRepo } from '../db/repos/stories.js';
import { knowledgeStateFor } from '../services/knowledge.js';
import { finishPlaythrough, startPlaythrough } from '../services/playthroughs.js';

/**
 * Knowledge-driven conditions (F641–F650): the binding payload the player
 * injects into the VM, plus playthrough lifecycle so snapshot/sandbox modes
 * can be established up front.
 */

const idParamsSchema = z.object({ id: z.string().min(1) });
const ptParamsSchema = z.object({
  id: z.string().min(1),
  playthroughId: z.string().min(1).max(200),
});

const knowledgeQuerySchema = z.object({
  playthroughId: z.string().min(1).max(200).optional(),
});

const startBodySchema = z.object({
  id: z.string().min(1).max(200),
  mode: z.enum(['live', 'snapshot']).optional(),
  sandbox: z.boolean().optional(),
});

registerRoute({
  method: 'GET',
  path: '/stories/:id/knowledge-state',
  summary: 'Binding payload (entity fields, note-exists flags, tags) for the VM',
  params: idParamsSchema,
  query: knowledgeQuerySchema,
});
registerRoute({
  method: 'POST',
  path: '/stories/:id/playthroughs',
  summary: 'Start a playthrough (live/snapshot binding mode, optional sandbox)',
  params: idParamsSchema,
  body: startBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/playthroughs',
  summary: 'List a story’s playthroughs',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/stories/:id/playthroughs/:playthroughId/finish',
  summary: 'Mark a playthrough finished (idempotent)',
  params: ptParamsSchema,
});

export const knowledgeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/stories/:id/knowledge-state', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const { playthroughId } = parseWith(knowledgeQuerySchema, request.query, 'query');
    return { data: knowledgeStateFor(app.db, id as StoryId, playthroughId ?? '__preview__') };
  });

  app.post('/stories/:id/playthroughs', async (request, reply) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(startBodySchema, request.body, 'body');
    const playthrough = startPlaythrough(app.db, id as StoryId, {
      id: body.id,
      ...(body.mode !== undefined ? { mode: body.mode } : {}),
      ...(body.sandbox !== undefined ? { sandbox: body.sandbox } : {}),
    });
    reply.status(201);
    return { data: playthrough };
  });

  app.get('/stories/:id/playthroughs', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    storiesRepo(app.db).mustGet(id as StoryId);
    return { data: playthroughsRepo(app.db).list(id as StoryId) };
  });

  app.post('/stories/:id/playthroughs/:playthroughId/finish', async (request) => {
    const { id, playthroughId } = parseWith(ptParamsSchema, request.params, 'params');
    return { data: finishPlaythrough(app.db, id as StoryId, playthroughId) };
  });
};
