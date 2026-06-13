import { notFound, validation, type StoryId } from '@fables/core';
import { validateSaveShape, type StorySaveState } from '@fables/forge-vm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { withTransaction } from '../db/connection.js';
import { storiesRepo } from '../db/repos/stories.js';
import { storySavesRepo, type StorySave, type StorySaveMeta } from '../db/repos/story-saves.js';

/**
 * Save slot + autosave routes (F462/F463). `state` payloads are the forge-vm
 * serialized save state and are validated structurally before they touch the
 * database — a corrupt save should fail loudly at write time, not at load.
 */

const storyParamsSchema = z.object({ id: z.string().min(1) });
const saveParamsSchema = z.object({ id: z.string().min(1), saveId: z.string().min(1) });

const slotBodySchema = z.object({
  name: z.string().min(1).max(100),
  state: z.unknown(),
});

const autosaveBodySchema = z.object({ state: z.unknown() });

const listQuerySchema = z.object({ kind: z.enum(['slot', 'auto']).optional() });

registerRoute({
  method: 'POST',
  path: '/stories/:id/saves',
  summary: 'Create or overwrite a named save slot',
  params: storyParamsSchema,
  body: slotBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/saves',
  summary: 'List saves (metadata only; ?kind=slot|auto)',
  params: storyParamsSchema,
  query: listQuerySchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/saves/:saveId',
  summary: 'Fetch a save with its full state',
  params: saveParamsSchema,
});
registerRoute({
  method: 'DELETE',
  path: '/stories/:id/saves/:saveId',
  summary: 'Delete a save',
  params: saveParamsSchema,
});
registerRoute({
  method: 'PUT',
  path: '/stories/:id/autosave',
  summary: 'Push an autosave (ring buffer of the last 10)',
  params: storyParamsSchema,
  body: autosaveBodySchema,
});

/** Structural validation via the VM's own save-shape contract (F469). */
function parseSaveState(value: unknown): StorySaveState {
  try {
    validateSaveShape(value);
    return value;
  } catch (error) {
    throw validation(`invalid save state: ${(error as Error).message}`);
  }
}

function meta(save: StorySave): StorySaveMeta {
  const { state: _state, ...rest } = save;
  return rest;
}

export const storySavesRoutes: FastifyPluginAsync = async (app) => {
  const stories = () => storiesRepo(app.db);
  const saves = () => storySavesRepo(app.db);

  app.post('/stories/:id/saves', async (request, reply) => {
    const { id } = parseWith(storyParamsSchema, request.params, 'params');
    const body = parseWith(slotBodySchema, request.body, 'body');
    const state = parseSaveState(body.state);
    const result = withTransaction(app.db, () => {
      const story = stories().mustGet(id as StoryId);
      return saves().upsertSlot(story.id, body.name, state);
    });
    reply.status(result.created ? 201 : 200);
    return { data: meta(result.save) };
  });

  app.get('/stories/:id/saves', async (request) => {
    const { id } = parseWith(storyParamsSchema, request.params, 'params');
    const query = parseWith(listQuerySchema, request.query, 'query');
    const story = stories().mustGet(id as StoryId);
    return { data: saves().list(story.id, query.kind) };
  });

  app.get('/stories/:id/saves/:saveId', async (request) => {
    const { id, saveId } = parseWith(saveParamsSchema, request.params, 'params');
    const story = stories().mustGet(id as StoryId);
    const save = saves().get(story.id, saveId);
    if (!save) throw notFound('Save', saveId);
    return { data: save };
  });

  app.delete('/stories/:id/saves/:saveId', async (request) => {
    const { id, saveId } = parseWith(saveParamsSchema, request.params, 'params');
    const story = stories().mustGet(id as StoryId);
    saves().remove(story.id, saveId);
    return { data: { id: saveId, deleted: true } };
  });

  app.put('/stories/:id/autosave', async (request) => {
    const { id } = parseWith(storyParamsSchema, request.params, 'params');
    const body = parseWith(autosaveBodySchema, request.body, 'body');
    const state = parseSaveState(body.state);
    const result = withTransaction(app.db, () => {
      const story = stories().mustGet(id as StoryId);
      return saves().pushAutosave(story.id, state);
    });
    return { data: { save: meta(result.save), retained: result.retained } };
  });
};
