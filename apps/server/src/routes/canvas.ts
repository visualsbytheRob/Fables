/**
 * Canvas routes (Epic 16, F1502/F1508).
 *
 *   POST   /canvas                  — create a canvas
 *   GET    /canvas                  — list canvases
 *   GET    /canvas/:id              — canvas + its objects (optional ?region= cull)
 *   PATCH  /canvas/:id              — rename
 *   DELETE /canvas/:id              — delete (cascades to objects)
 *   PUT    /canvas/:id/objects      — snapshot the object set (autosave)
 */

import type { FastifyPluginAsync } from 'fastify';
import { notFound } from '@fables/core';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { canvasRepo } from '../db/repos/canvas.js';

registerRoute({ method: 'POST', path: '/canvas', summary: 'Create a canvas (F1502)' });
registerRoute({ method: 'GET', path: '/canvas', summary: 'List canvases' });
registerRoute({
  method: 'GET',
  path: '/canvas/:id',
  summary: 'Get a canvas + objects (F1503 cull)',
});
registerRoute({ method: 'PATCH', path: '/canvas/:id', summary: 'Rename a canvas' });
registerRoute({ method: 'DELETE', path: '/canvas/:id', summary: 'Delete a canvas' });
registerRoute({ method: 'PUT', path: '/canvas/:id/objects', summary: 'Autosave objects (F1508)' });

const idParams = z.object({ id: z.string().min(1) });
const createBody = z.object({ name: z.string().min(1).max(200) });
const renameBody = z.object({ name: z.string().min(1).max(200) });

const OBJECT_KINDS = [
  'note',
  'entity',
  'text',
  'sticky',
  'image',
  'query',
  'embed',
  'shape',
  'knot',
  'group',
] as const;

const objectSchema = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(OBJECT_KINDS),
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0),
  z: z.number().int().optional(),
  rotation: z.number().optional(),
  locked: z.boolean().optional(),
  groupId: z.string().min(1).nullable().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const objectsBody = z.object({ objects: z.array(objectSchema).max(50_000) });

const regionQuery = z.object({
  region: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
    .optional(),
});

export const canvasRoutes: FastifyPluginAsync = async (app) => {
  const repo = () => canvasRepo(app.db);

  app.post('/canvas', async (request, reply) => {
    const { name } = parseWith(createBody, request.body, 'body');
    return reply.status(201).send({ data: repo().create(name) });
  });

  app.get('/canvas', async () => ({ data: repo().list() }));

  app.get('/canvas/:id', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const canvas = repo().get(id);
    if (!canvas) throw notFound('Canvas', id);
    const { region } = parseWith(regionQuery, request.query, 'query');
    let objects;
    if (region) {
      const [minX, minY, maxX, maxY] = region.split(',').map(Number) as [
        number,
        number,
        number,
        number,
      ];
      objects = repo().objectsInRegion(id, { minX, minY, maxX, maxY });
    } else {
      objects = repo().listObjects(id);
    }
    return { data: { canvas, objects } };
  });

  app.patch('/canvas/:id', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const { name } = parseWith(renameBody, request.body, 'body');
    if (!repo().get(id)) throw notFound('Canvas', id);
    repo().rename(id, name);
    return { data: repo().get(id) };
  });

  app.delete('/canvas/:id', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    if (!repo().remove(id)) throw notFound('Canvas', id);
    return { data: { deleted: true } };
  });

  app.put('/canvas/:id/objects', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const { objects } = parseWith(objectsBody, request.body, 'body');
    if (!repo().get(id)) throw notFound('Canvas', id);
    const count = repo().replaceObjects(id, objects);
    return { data: { saved: count } };
  });
};
