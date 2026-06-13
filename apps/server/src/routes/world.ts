import { type EntityId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { worldRepo } from '../db/repos/world.js';
import {
  assertSnapshotName,
  createWorldSnapshot,
  diffSnapshots,
  revertEntity,
  worldDashboard,
} from '../services/world.js';

/**
 * World state inspector routes (F681–F690): the mutated-field dashboard, the
 * per-field/per-playthrough revert, named snapshots with a field-level diff,
 * and the multi-story conflict surface.
 */

const idParamsSchema = z.object({ id: z.string().min(1) });
const snapshotIdParamsSchema = z.object({ id: z.string().min(1) });
const diffParamsSchema = z.object({ a: z.string().min(1), b: z.string().min(1) });

const revertBodySchema = z.object({
  playthroughId: z.string().min(1).max(200).optional(),
  field: z.string().min(1).max(100).optional(),
});
const snapshotBodySchema = z.object({ name: z.string().min(1).max(200) });

registerRoute({
  method: 'GET',
  path: '/world',
  summary: 'World dashboard: every entity with story-mutated fields flagged',
});
registerRoute({
  method: 'GET',
  path: '/world/conflicts',
  summary: 'Fields written by two or more distinct stories',
});
registerRoute({
  method: 'POST',
  path: '/entities/:id/revert',
  summary: 'Restore an entity’s fields from the mutation audit (atomic, audited)',
  params: idParamsSchema,
  body: revertBodySchema,
});
registerRoute({
  method: 'POST',
  path: '/world/snapshots',
  summary: 'Capture a named snapshot of the entire entity state',
  body: snapshotBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/world/snapshots',
  summary: 'List world snapshots (metadata only)',
});
registerRoute({
  method: 'GET',
  path: '/world/snapshots/:id',
  summary: 'Fetch one world snapshot with its entity payload',
  params: snapshotIdParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/world/snapshots/:a/diff/:b',
  summary: 'Field-level diff between two world snapshots',
  params: diffParamsSchema,
});

export const worldRoutes: FastifyPluginAsync = async (app) => {
  app.get('/world', async () => {
    return { data: worldDashboard(app.db) };
  });

  app.get('/world/conflicts', async () => {
    return { data: worldRepo(app.db).conflicts() };
  });

  app.post('/entities/:id/revert', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(revertBodySchema, request.body, 'body');
    const result = revertEntity(app.db, id as EntityId, {
      ...(body.playthroughId !== undefined ? { playthroughId: body.playthroughId } : {}),
      ...(body.field !== undefined ? { field: body.field } : {}),
    });
    return { data: result };
  });

  app.post('/world/snapshots', async (request, reply) => {
    const body = parseWith(snapshotBodySchema, request.body, 'body');
    assertSnapshotName(body.name);
    const snapshot = createWorldSnapshot(app.db, body.name);
    reply.status(201);
    return { data: snapshot };
  });

  app.get('/world/snapshots', async () => {
    return { data: worldRepo(app.db).listSnapshots() };
  });

  app.get('/world/snapshots/:id', async (request) => {
    const { id } = parseWith(snapshotIdParamsSchema, request.params, 'params');
    return { data: worldRepo(app.db).mustGetSnapshot(id) };
  });

  app.get('/world/snapshots/:a/diff/:b', async (request) => {
    const { a, b } = parseWith(diffParamsSchema, request.params, 'params');
    return { data: diffSnapshots(app.db, a, b) };
  });
};
