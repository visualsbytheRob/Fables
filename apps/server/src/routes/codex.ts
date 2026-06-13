import type { EntityId, StoryId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { withTransaction } from '../db/connection.js';
import { codexRepo } from '../db/repos/codex.js';
import { codexFor, recordEncounter, recordReveal } from '../services/codex.js';

/**
 * Codex routes (F611–F620): met-tracking, revealed facts, and the
 * spoiler-safe per-playthrough codex view the player panel renders.
 */

const playthroughParamsSchema = z.object({
  id: z.string().min(1),
  playthroughId: z.string().min(1).max(200),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

const encounterBodySchema = z.object({ entityId: z.string().min(1) });
const revealBodySchema = z.object({
  entityId: z.string().min(1),
  field: z.string().min(1).max(100),
});

const codexQuerySchema = z.object({ playthroughId: z.string().min(1).max(200) });

registerRoute({
  method: 'POST',
  path: '/stories/:id/playthroughs/:playthroughId/encounters',
  summary: 'Record an entity-encountered event (met tracking)',
  params: playthroughParamsSchema,
  body: encounterBodySchema,
});
registerRoute({
  method: 'POST',
  path: '/stories/:id/playthroughs/:playthroughId/reveals',
  summary: 'Unlock visibility of one entity field for this playthrough',
  params: playthroughParamsSchema,
  body: revealBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/playthroughs/:playthroughId/mutations',
  summary: 'ENTITY_SET mutation audit for one playthrough',
  params: playthroughParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/codex',
  summary: 'Spoiler-safe codex: met entities with only their revealed fields',
  params: idParamsSchema,
  query: codexQuerySchema,
});

export const codexRoutes: FastifyPluginAsync = async (app) => {
  app.post('/stories/:id/playthroughs/:playthroughId/encounters', async (request, reply) => {
    const { id, playthroughId } = parseWith(playthroughParamsSchema, request.params, 'params');
    const body = parseWith(encounterBodySchema, request.body, 'body');
    const result = withTransaction(app.db, () =>
      recordEncounter(app.db, id as StoryId, playthroughId, body.entityId as EntityId),
    );
    reply.status(result.repeat ? 200 : 201);
    return { data: result };
  });

  app.post('/stories/:id/playthroughs/:playthroughId/reveals', async (request, reply) => {
    const { id, playthroughId } = parseWith(playthroughParamsSchema, request.params, 'params');
    const body = parseWith(revealBodySchema, request.body, 'body');
    const result = withTransaction(app.db, () =>
      recordReveal(app.db, id as StoryId, playthroughId, body.entityId as EntityId, body.field),
    );
    reply.status(result.revealed ? 201 : 200);
    return { data: result };
  });

  app.get('/stories/:id/playthroughs/:playthroughId/mutations', async (request) => {
    const { id, playthroughId } = parseWith(playthroughParamsSchema, request.params, 'params');
    return { data: codexRepo(app.db).listMutations(id as StoryId, playthroughId) };
  });

  app.get('/stories/:id/codex', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const { playthroughId } = parseWith(codexQuerySchema, request.query, 'query');
    return { data: codexFor(app.db, id as StoryId, playthroughId) };
  });
};
