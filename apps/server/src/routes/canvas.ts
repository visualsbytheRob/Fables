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
import { notFound, validation } from '@fables/core';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { canvasRepo } from '../db/repos/canvas.js';
import { canvasEdgesRepo } from '../db/repos/canvas-edges.js';
import { canConnect, materializeConnectorLink } from '../canvas/connections.js';
import { buildStoryMap } from '../canvas/story-map.js';
import { importObsidianCanvas, importExcalidraw } from '../canvas/canvas-interop.js';
import { exportCanvasSvg } from '../canvas/svg-export.js';
import { buildBoard, type BoardItem } from '../canvas/boards.js';
import { noteCanvasPlacements, searchCanvasObjects } from '../canvas/embedding.js';
import type { ObjectInput } from '../db/repos/canvas.js';
import type { CanvasObjectKind } from '../canvas/types.js';
import { notesRepo } from '../db/repos/notes.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { tagsRepo } from '../db/repos/tags.js';
import { runFqlQuery } from '../services/query.js';
import type { NoteId, NotebookId } from '@fables/core';

registerRoute({
  method: 'POST',
  path: '/canvas/:id/story-map',
  summary: 'Generate a story map (knot cards + diverts) from Forge source (F1541)',
});
registerRoute({
  method: 'POST',
  path: '/canvas/:id/import',
  summary: 'Import an Obsidian Canvas / Excalidraw file onto a canvas (F1594)',
});
registerRoute({
  method: 'GET',
  path: '/canvas/:id/svg',
  summary: 'Export a canvas as SVG (F1593)',
});
registerRoute({ method: 'GET', path: '/canvas/search', summary: 'Search canvas objects (F1567)' });
registerRoute({
  method: 'POST',
  path: '/board',
  summary: 'Build a Kanban board from notes (F1551)',
});
registerRoute({
  method: 'GET',
  path: '/notes/:id/canvas-placements',
  summary: 'Canvases where a note is placed (F1563)',
});
registerRoute({ method: 'GET', path: '/canvas/:id/edges', summary: 'List connectors (F1521)' });
registerRoute({
  method: 'POST',
  path: '/canvas/:id/edges',
  summary: 'Create a connector; link kind writes a real link (F1523/F1528)',
});
registerRoute({
  method: 'DELETE',
  path: '/canvas/:id/edges/:edgeId',
  summary: 'Delete a connector',
});
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
const edgeParams = z.object({ id: z.string().min(1), edgeId: z.string().min(1) });
const createBody = z.object({ name: z.string().min(1).max(200) });
const renameBody = z.object({ name: z.string().min(1).max(200) });

const edgeBody = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  kind: z.string().min(1).max(40).optional(),
  label: z.string().max(200).optional(),
  style: z.enum(['curved', 'orthogonal', 'straight']).optional(),
});

const storyMapBody = z.object({ source: z.string().min(1).max(2_000_000) });

const importBody = z.object({
  format: z.enum(['obsidian', 'excalidraw']),
  source: z.string().min(1).max(20_000_000),
});

const boardBody = z.object({
  query: z.string().max(2000).optional(),
  notebookId: z.string().min(1).optional(),
  groupBy: z.string().min(1).max(60),
  columnOrder: z.array(z.string()).max(50).optional(),
  wipLimits: z.record(z.string(), z.number().int().min(0)).optional(),
});

const searchQuery = z.object({ q: z.string().min(1).max(200) });

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

  // ── Connectors (F1521/F1523/F1528) ─────────────────────────────────────────

  app.get('/canvas/:id/edges', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    if (!repo().get(id)) throw notFound('Canvas', id);
    return { data: canvasEdgesRepo(app.db).list(id) };
  });

  app.post('/canvas/:id/edges', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const body = parseWith(edgeBody, request.body, 'body');
    if (!repo().get(id)) throw notFound('Canvas', id);

    const objects = repo().listObjects(id);
    const from = objects.find((o) => o.id === body.fromId);
    const to = objects.find((o) => o.id === body.toId);
    if (!from || !to) throw notFound('CanvasObject', `${body.fromId} or ${body.toId}`);

    const kind = body.kind ?? 'line';
    const decision = canConnect(from.kind, to.kind, kind);
    if (!decision.allowed) throw validation(decision.reason ?? 'invalid connection');

    const edge = canvasEdgesRepo(app.db).create(id, {
      fromId: body.fromId,
      toId: body.toId,
      kind,
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.style !== undefined ? { style: body.style } : {}),
    });
    // F1523: a link connector between note cards becomes a real graph link.
    const linked = kind === 'link' ? materializeConnectorLink(app.db, from, to) : false;
    return { data: { edge, linkCreated: linked } };
  });

  app.delete('/canvas/:id/edges/:edgeId', async (request) => {
    const { id, edgeId } = parseWith(edgeParams, request.params, 'params');
    if (!canvasEdgesRepo(app.db).remove(id, edgeId)) throw notFound('CanvasEdge', edgeId);
    return { data: { deleted: true } };
  });

  // F1594: import an Obsidian Canvas / Excalidraw file onto this canvas.
  app.post('/canvas/:id/import', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const { format, source } = parseWith(importBody, request.body, 'body');
    if (!repo().get(id)) throw notFound('Canvas', id);
    const map = format === 'obsidian' ? importObsidianCanvas(source) : importExcalidraw(source);
    const objects: ObjectInput[] = map.objects.map((o) => ({
      ...(o.id !== undefined ? { id: o.id } : {}),
      kind: o.kind as CanvasObjectKind,
      x: o.x,
      y: o.y,
      width: o.width,
      height: o.height,
      ...(o.z !== undefined ? { z: o.z } : {}),
      ...(o.data !== undefined ? { data: o.data } : {}),
    }));
    repo().replaceObjects(id, objects);
    const edges = canvasEdgesRepo(app.db);
    for (const e of map.edges) {
      edges.create(id, {
        fromId: e.fromId,
        toId: e.toId,
        ...(e.kind !== undefined ? { kind: e.kind } : {}),
        ...(e.label !== undefined ? { label: e.label } : {}),
      });
    }
    return { data: { objects: objects.length, edges: map.edges.length } };
  });

  // F1593: export the canvas as a standalone SVG.
  app.get('/canvas/:id/svg', async (request, reply) => {
    const { id } = parseWith(idParams, request.params, 'params');
    if (!repo().get(id)) throw notFound('Canvas', id);
    const svg = exportCanvasSvg(repo().listObjects(id), canvasEdgesRepo(app.db).list(id));
    return reply.header('content-type', 'image/svg+xml').send(svg);
  });

  // F1567: search objects across all canvases.
  app.get('/canvas/search', async (request) => {
    const { q } = parseWith(searchQuery, request.query, 'query');
    return { data: searchCanvasObjects(app.db, q) };
  });

  // F1551: build a Kanban board from notes (FQL query / notebook / all).
  app.post('/board', async (request) => {
    const body = parseWith(boardBody, request.body, 'body');
    const notes = body.query
      ? runFqlQuery(app.db, body.query, { fetch: 2000, cursor: null }).notes
      : notesRepo(app.db).list({
          sort: 'updated',
          fetch: 2000,
          cursor: null,
          ...(body.notebookId !== undefined ? { notebookId: body.notebookId as NotebookId } : {}),
        });
    const nb = notebooksRepo(app.db);
    const tags = tagsRepo(app.db);
    const items: BoardItem[] = notes.map((n) => ({
      id: n.id,
      title: n.title,
      tags: tags.tagsForNote(n.id as NoteId).map((t) => t.name),
      fields: { notebook: nb.get(n.notebookId as NotebookId)?.name ?? '(unset)' },
    }));
    const board = buildBoard(items, {
      groupBy: body.groupBy,
      ...(body.columnOrder !== undefined ? { columnOrder: body.columnOrder } : {}),
      ...(body.wipLimits !== undefined ? { wipLimits: body.wipLimits } : {}),
    });
    return { data: board };
  });

  // F1563: which canvases is a note placed on?
  app.get('/notes/:id/canvas-placements', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    return { data: noteCanvasPlacements(app.db, id) };
  });

  // F1541: lay out a Forge story as knot cards + divert connectors on the canvas.
  app.post('/canvas/:id/story-map', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const { source } = parseWith(storyMapBody, request.body, 'body');
    if (!repo().get(id)) throw notFound('Canvas', id);
    const map = buildStoryMap(source);
    repo().replaceObjects(id, map.objects);
    const edges = canvasEdgesRepo(app.db);
    for (const e of map.edges) edges.create(id, e);
    return { data: { objects: map.objects.length, edges: map.edges.length } };
  });
};
