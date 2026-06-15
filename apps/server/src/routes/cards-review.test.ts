/**
 * Undo + session-summary route tests (Epic 18, F1728/F1729).
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

async function createCard(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/cards',
    payload: { prompt: 'q', answer: 'a' },
  });
  return (res.json() as { data: { id: string } }).data.id;
}

describe('POST /cards/:id/undo (F1728)', () => {
  it('undoes the last rating, returning the card to new', async () => {
    const id = await createCard();
    await app.inject({
      method: 'POST',
      url: `/api/v1/cards/${id}/review`,
      payload: { rating: 3, now: '2026-06-15T10:00:00.000Z' },
    });
    const undo = await app.inject({ method: 'POST', url: `/api/v1/cards/${id}/undo` });
    expect(undo.statusCode).toBe(200);
    expect((undo.json() as { data: { state: string } }).data.state).toBe('new');
  });

  it('404s when there is nothing to undo', async () => {
    const id = await createCard();
    const undo = await app.inject({ method: 'POST', url: `/api/v1/cards/${id}/undo` });
    expect(undo.statusCode).toBe(404);
  });
});

describe('GET /review/summary (F1729)', () => {
  it('summarises reviews in a window', async () => {
    const id = await createCard();
    await app.inject({
      method: 'POST',
      url: `/api/v1/cards/${id}/review`,
      payload: { rating: 4, now: new Date().toISOString() },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/review/summary' });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { reviews: number; byRating: { easy: number } } }).data;
    expect(data.reviews).toBeGreaterThanOrEqual(1);
    expect(data.byRating.easy).toBeGreaterThanOrEqual(1);
  });
});
