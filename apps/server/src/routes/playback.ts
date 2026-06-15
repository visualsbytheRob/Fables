/**
 * Playback system routes (Epic 17, F1671–F1680).
 *
 *  GET    /playback/:type/:id          — resume position for an item (F1673)
 *  PUT    /playback/:type/:id          — save position + listened delta (F1673/F1678)
 *  DELETE /playback/:type/:id          — clear position
 *  GET    /playback/stats              — listening stats: time + completion (F1678)
 *  GET    /playback/queue              — the listening queue (F1674)
 *  POST   /playback/queue              — append an item to the queue
 *  PUT    /playback/queue/order        — reorder the queue
 *  DELETE /playback/queue/:entryId     — remove a queue entry
 *  GET    /playback/pins               — offline-pinned items (F1675)
 *  PUT    /playback/pins/:type/:id     — pin/unpin an item
 *
 * Media Session lock-screen controls, background playback, Bluetooth/headphone
 * handling, and interruption recovery are the web/PWA layer; this persists the
 * resume positions, queue, pins, and stats they drive across devices.
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { playbackRepo, type PlayItemType } from '../db/repos/playback.js';

registerRoute({ method: 'GET', path: '/playback/:type/:id', summary: 'Resume position (F1673)' });
registerRoute({
  method: 'PUT',
  path: '/playback/:type/:id',
  summary: 'Save position (F1673/F1678)',
});
registerRoute({ method: 'DELETE', path: '/playback/:type/:id', summary: 'Clear position' });
registerRoute({ method: 'GET', path: '/playback/stats', summary: 'Listening stats (F1678)' });
registerRoute({ method: 'GET', path: '/playback/queue', summary: 'Listening queue (F1674)' });
registerRoute({ method: 'POST', path: '/playback/queue', summary: 'Append to the queue (F1674)' });
registerRoute({
  method: 'PUT',
  path: '/playback/queue/order',
  summary: 'Reorder the queue (F1674)',
});
registerRoute({
  method: 'DELETE',
  path: '/playback/queue/:entryId',
  summary: 'Remove a queue entry',
});
registerRoute({ method: 'GET', path: '/playback/pins', summary: 'Offline-pinned items (F1675)' });
registerRoute({
  method: 'PUT',
  path: '/playback/pins/:type/:id',
  summary: 'Pin/unpin an item (F1675)',
});

const itemParams = z.object({
  type: z.enum(['story', 'note']),
  id: z.string().min(1),
});

const savePositionBody = z.object({
  positionMs: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  /** Actual ms listened since the last save, for stats (F1678). */
  listenedDeltaMs: z.number().int().min(0).optional(),
});

const queueAddBody = z.object({
  itemType: z.enum(['story', 'note']),
  itemId: z.string().min(1),
  title: z.string().max(500).optional(),
});

const reorderBody = z.object({ ids: z.array(z.string().min(1)).max(5000) });

const pinBody = z.object({ pinned: z.boolean(), title: z.string().max(500).optional() });

export const playbackRoutes: FastifyPluginAsync = async (app) => {
  const repo = playbackRepo(app.db);

  // ── stats + queue + pins (static paths first so they don't shadow :type/:id)
  app.get('/playback/stats', async () => {
    return { data: repo.position.stats() };
  });

  app.get('/playback/queue', async () => {
    return { data: { queue: repo.queue.list() } };
  });

  app.post('/playback/queue', async (request) => {
    const body = parseWith(queueAddBody, request.body, 'body');
    return { data: repo.queue.add(body.itemType, body.itemId, body.title ?? '') };
  });

  app.put('/playback/queue/order', async (request) => {
    const body = parseWith(reorderBody, request.body, 'body');
    return { data: { queue: repo.queue.reorder(body.ids) } };
  });

  app.delete('/playback/queue/:entryId', async (request) => {
    const { entryId } = parseWith(
      z.object({ entryId: z.string().min(1) }),
      request.params,
      'params',
    );
    if (!repo.queue.remove(entryId)) throw notFound('queue entry', entryId);
    return { data: { removed: true } };
  });

  app.get('/playback/pins', async () => {
    return { data: { pins: repo.pins.list() } };
  });

  app.put('/playback/pins/:type/:id', async (request) => {
    const { type, id } = parseWith(itemParams, request.params, 'params');
    const body = parseWith(pinBody, request.body, 'body');
    const pinned = repo.pins.set(type as PlayItemType, id, body.pinned, body.title ?? '');
    return { data: { itemType: type, itemId: id, pinned } };
  });

  // ── per-item resume position
  app.get('/playback/:type/:id', async (request) => {
    const { type, id } = parseWith(itemParams, request.params, 'params');
    const pos = repo.position.get(type as PlayItemType, id);
    return { data: pos ?? { itemType: type, itemId: id, positionMs: 0, completed: false } };
  });

  app.put('/playback/:type/:id', async (request) => {
    const { type, id } = parseWith(itemParams, request.params, 'params');
    const body = parseWith(savePositionBody, request.body, 'body');
    const pos = repo.position.save(
      type as PlayItemType,
      id,
      body.positionMs,
      body.durationMs,
      body.listenedDeltaMs ?? 0,
    );
    return { data: pos };
  });

  app.delete('/playback/:type/:id', async (request) => {
    const { type, id } = parseWith(itemParams, request.params, 'params');
    repo.position.clear(type as PlayItemType, id);
    return { data: { cleared: true } };
  });
};
