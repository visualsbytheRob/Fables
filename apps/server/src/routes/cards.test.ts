/**
 * Card route tests (Epic 18, F1701–F1710).
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

async function createCard(prompt: string, answer: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/cards',
    payload: { prompt, answer },
  });
  return (res.json() as { data: { id: string } }).data.id;
}

describe('card creation + review (F1701/F1702/F1703)', () => {
  it('creates, reviews (reschedules via FSRS), and logs', async () => {
    const id = await createCard('2+2?', '4');

    const review = await app.inject({
      method: 'POST',
      url: `/api/v1/cards/${id}/review`,
      payload: { rating: 3, now: '2026-06-15T10:00:00.000Z' },
    });
    expect(review.statusCode).toBe(200);
    const card = (review.json() as { data: { state: string; due: string; reps: number } }).data;
    expect(card.state).toBe('review');
    expect(new Date(card.due).getTime()).toBeGreaterThan(
      new Date('2026-06-15T10:00:00.000Z').getTime(),
    );
    expect(card.reps).toBe(1);

    const log = await app.inject({ method: 'GET', url: `/api/v1/cards/${id}/log` });
    expect((log.json() as { data: { log: unknown[] } }).data.log).toHaveLength(1);
  });

  it('404s reviewing an unknown card', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cards/card_nope/review',
      payload: { rating: 3 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an out-of-range rating', async () => {
    const id = await createCard('q', 'a');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/cards/${id}/review`,
      payload: { rating: 9 },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('review queue + counts (F1705/F1706)', () => {
  it('serves due + new cards and reports counts', async () => {
    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/review/queue?now=2026-12-01T10:00:00.000Z&newLimit=5',
    });
    expect(queue.statusCode).toBe(200);
    expect((queue.json() as { data: { cards: unknown[] } }).data.cards.length).toBeGreaterThan(0);

    const counts = await app.inject({ method: 'GET', url: '/api/v1/review/counts' });
    const data = (counts.json() as { data: { total: number } }).data;
    expect(data.total).toBeGreaterThan(0);
  });
});

describe('suspend / bury (F1707)', () => {
  it('suspends and unsuspends a card', async () => {
    const id = await createCard('s', 'a');
    const susp = await app.inject({ method: 'POST', url: `/api/v1/cards/${id}/suspend` });
    expect((susp.json() as { data: { state: string } }).data.state).toBe('suspended');
    const card = await app.inject({ method: 'GET', url: `/api/v1/cards/${id}` });
    expect((card.json() as { data: { state: string } }).data.state).toBe('suspended');
    const un = await app.inject({ method: 'POST', url: `/api/v1/cards/${id}/unsuspend` });
    expect((un.json() as { data: { state: string } }).data.state).toBe('new');
  });
});
