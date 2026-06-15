/**
 * Scheduler edge + settings route tests (Epic 18, F1762/F1764/F1765).
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

describe('learning settings (F1764)', () => {
  it('round-trips settings and pauses the session on vacation', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/learning/settings',
      payload: { vacationUntil: '2099-01-01T00:00:00.000Z', dailyNewCap: 5 },
    });
    expect(put.statusCode).toBe(200);
    const data = (put.json() as { data: { dailyNewCap: number } }).data;
    expect(data.dailyNewCap).toBe(5);

    // With a future vacation date, the session is empty.
    const session = await app.inject({ method: 'GET', url: '/api/v1/review/session' });
    expect((session.json() as { data: { vacation: boolean } }).data.vacation).toBe(true);

    // Clear vacation.
    await app.inject({
      method: 'PUT',
      url: '/api/v1/learning/settings',
      payload: { vacationUntil: null },
    });
  });
});

describe('GET /review/session (F1761/F1765)', () => {
  it('builds a non-vacation session of due/new cards', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/cards',
        payload: { prompt: `session-card-${i}`, answer: 'a' },
      });
    }
    const res = await app.inject({ method: 'GET', url: '/api/v1/review/session' });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { vacation: boolean; cards: unknown[] } }).data;
    expect(data.vacation).toBe(false);
    expect(data.cards.length).toBeGreaterThan(0);
  });
});

describe('GET /cards/duplicates (F1762)', () => {
  it('finds cards sharing a prompt', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/cards',
      payload: { prompt: 'duplicate prompt here', answer: 'a' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/cards',
      payload: { prompt: 'Duplicate Prompt Here', answer: 'b' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/cards/duplicates' });
    const dups = (res.json() as { data: { duplicates: { cardIds: string[] }[] } }).data.duplicates;
    expect(dups.some((d) => d.cardIds.length >= 2)).toBe(true);
  });
});
