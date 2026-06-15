/**
 * Deck route tests (Epic 18, F1741–F1748).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  // Seed a couple of cards.
  for (const [prompt, kind] of [
    ['c1', 'cloze'],
    ['c2', 'basic'],
    ['c3', 'cloze'],
  ] as const) {
    await app.inject({
      method: 'POST',
      url: '/api/v1/cards',
      payload: { prompt, answer: 'a', kind },
    });
  }
});

afterAll(async () => {
  await app.close();
});

describe('deck CRUD + membership (F1741)', () => {
  it('creates a deck and lists its dynamic members', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/decks',
      payload: { name: 'Cloze', filter: { kind: 'cloze' }, settings: { requestRetention: 0.85 } },
    });
    expect(create.statusCode).toBe(200);
    const deck = (create.json() as { data: { id: string } }).data;

    const members = await app.inject({ method: 'GET', url: `/api/v1/decks/${deck.id}/cards` });
    const cards = (members.json() as { data: { cards: { kind: string }[] } }).data.cards;
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards.every((c) => c.kind === 'cloze')).toBe(true);
  });

  it('dashboard reports counts + forecast (F1743)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/decks',
      payload: { name: 'All', filter: {} },
    });
    const id = (create.json() as { data: { id: string } }).data.id;
    const dash = await app.inject({ method: 'GET', url: `/api/v1/decks/${id}/dashboard?days=7` });
    const data = (dash.json() as { data: { total: number; forecast: unknown[] } }).data;
    expect(data.total).toBeGreaterThanOrEqual(3);
    expect(data.forecast.length).toBe(7);
  });

  it('exports and imports a .fdeck (F1746)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/decks',
      payload: { name: 'Export me', filter: { kind: 'cloze' } },
    });
    const id = (create.json() as { data: { id: string } }).data.id;
    const exp = await app.inject({ method: 'GET', url: `/api/v1/decks/${id}/export` });
    const snapshot = (exp.json() as { data: Record<string, unknown> }).data;

    const imp = await app.inject({
      method: 'POST',
      url: '/api/v1/decks/import',
      payload: snapshot,
    });
    expect(imp.statusCode).toBe(200);
    expect((imp.json() as { data: { name: string } }).data.name).toBe('Export me');
  });

  it('404s for an unknown deck', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/decks/deck_nope' });
    expect(res.statusCode).toBe(404);
  });
});

describe('custom study + cross-deck review (F1744/F1748)', () => {
  it('runs an ad-hoc filtered study session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/study',
      payload: { filter: { kind: 'cloze' } },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { cards: unknown[] } }).data.cards.length).toBeGreaterThanOrEqual(
      2,
    );
  });
});
