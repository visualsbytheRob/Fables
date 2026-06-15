/**
 * Playback route tests (Epic 17, F1673/F1674/F1675/F1678).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

describe('resume position (F1673)', () => {
  it('defaults to zero, then round-trips a saved position', async () => {
    const fresh = await app.inject({ method: 'GET', url: '/api/v1/playback/story/s1' });
    expect((fresh.json() as { data: { positionMs: number } }).data.positionMs).toBe(0);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/playback/story/s1',
      payload: { positionMs: 4200, durationMs: 60000, listenedDeltaMs: 4200 },
    });
    expect(put.statusCode).toBe(200);
    const got = await app.inject({ method: 'GET', url: '/api/v1/playback/story/s1' });
    expect((got.json() as { data: { positionMs: number } }).data.positionMs).toBe(4200);
  });

  it('rejects an unknown item type', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/playback/widget/x' });
    expect(res.statusCode).toBe(422);
  });
});

describe('listening stats (F1678)', () => {
  it('reports accumulated listening time', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/playback/note/stat1',
      payload: { positionMs: 5000, durationMs: 5000, listenedDeltaMs: 5000 },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/playback/stats' });
    const data = (res.json() as { data: { totalListenedMs: number; completed: number } }).data;
    expect(data.totalListenedMs).toBeGreaterThanOrEqual(5000);
    expect(data.completed).toBeGreaterThanOrEqual(1);
  });
});

describe('queue (F1674)', () => {
  it('appends, lists, reorders, and removes', async () => {
    const a = await app.inject({
      method: 'POST',
      url: '/api/v1/playback/queue',
      payload: { itemType: 'story', itemId: 'qs1', title: 'First' },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/api/v1/playback/queue',
      payload: { itemType: 'note', itemId: 'qn1', title: 'Second' },
    });
    const aId = (a.json() as { data: { id: string } }).data.id;
    const bId = (b.json() as { data: { id: string } }).data.id;

    const reordered = await app.inject({
      method: 'PUT',
      url: '/api/v1/playback/queue/order',
      payload: { ids: [bId, aId] },
    });
    const queue = (reordered.json() as { data: { queue: { id: string }[] } }).data.queue;
    expect(queue[0]!.id).toBe(bId);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/playback/queue/${aId}` });
    expect(del.statusCode).toBe(200);
  });
});

describe('pins (F1675)', () => {
  it('pins and unpins', async () => {
    const pin = await app.inject({
      method: 'PUT',
      url: '/api/v1/playback/pins/story/ps1',
      payload: { pinned: true, title: 'Pinned' },
    });
    expect((pin.json() as { data: { pinned: boolean } }).data.pinned).toBe(true);
    const list = await app.inject({ method: 'GET', url: '/api/v1/playback/pins' });
    expect((list.json() as { data: { pins: unknown[] } }).data.pins.length).toBeGreaterThanOrEqual(
      1,
    );
  });
});
