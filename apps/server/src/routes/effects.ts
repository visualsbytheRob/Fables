import type { StoryId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { codexRepo } from '../db/repos/codex.js';
import { storiesRepo } from '../db/repos/stories.js';
import { ingestEffects, type EffectEventInput } from '../services/effects.js';

/**
 * VM host-effect ingestion (F631–F640): the player batches journal /
 * entity_set / encounter / reveal effects from the VM and posts them here.
 */

const idParamsSchema = z.object({ id: z.string().min(1) });

const eventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('journal'),
    payload: z.object({
      text: z.string().min(1).max(4000),
      scene: z.string().max(300).optional(),
      choice: z.string().max(1000).optional(),
    }),
  }),
  z.object({
    type: z.literal('entity_set'),
    payload: z.object({
      entity: z.string().min(1).max(200),
      field: z.string().min(1).max(100),
      value: z.unknown(),
    }),
  }),
  z.object({
    type: z.literal('encounter'),
    payload: z.object({ entity: z.string().min(1).max(200) }),
  }),
  z.object({
    type: z.literal('reveal'),
    payload: z.object({
      entity: z.string().min(1).max(200),
      field: z.string().min(1).max(100),
    }),
  }),
]);

const ingestBodySchema = z.object({
  playthroughId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(200),
  events: z.array(eventSchema).min(1).max(200),
});

const auditQuerySchema = z.object({
  playthroughId: z.string().min(1).max(200).optional(),
});

registerRoute({
  method: 'POST',
  path: '/stories/:id/effects',
  summary: 'Ingest a batch of VM host effects (atomic, idempotent per key)',
  params: idParamsSchema,
  body: ingestBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/effects',
  summary: 'Per-playthrough audit of every ingested effect event',
  params: idParamsSchema,
  query: auditQuerySchema,
});

export const effectsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/stories/:id/effects', async (request, reply) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(ingestBodySchema, request.body, 'body');
    const result = ingestEffects(app.db, id as StoryId, {
      playthroughId: body.playthroughId,
      idempotencyKey: body.idempotencyKey,
      events: body.events as EffectEventInput[],
    });
    reply.status(result.replayed ? 200 : 201);
    return { data: result };
  });

  app.get('/stories/:id/effects', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const query = parseWith(auditQuerySchema, request.query, 'query');
    const story = storiesRepo(app.db).mustGet(id as StoryId);
    return { data: codexRepo(app.db).listEffectEvents(story.id, query.playthroughId) };
  });
};
