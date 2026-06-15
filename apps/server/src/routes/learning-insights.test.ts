/**
 * Learning insights route tests (Epic 18, F1751–F1759).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  // Create + review a card so insights have data.
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/cards',
    payload: { prompt: 'q', answer: 'a' },
  });
  const id = (create.json() as { data: { id: string } }).data.id;
  await app.inject({
    method: 'POST',
    url: `/api/v1/cards/${id}/review`,
    payload: { rating: 3, now: '2026-06-15T10:00:00.000Z' },
  });
});

afterAll(async () => {
  await app.close();
});

describe('learning insights endpoints', () => {
  it('serve retention, heatmap, difficulty, coverage, streak, and export', async () => {
    const endpoints = [
      'retention',
      'heatmap',
      'forecast',
      'difficulty',
      'leeches',
      'coverage',
      'streak',
      'export',
    ];
    for (const e of endpoints) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/learning/insights/${e}` });
      expect(res.statusCode).toBe(200);
    }
  });

  it('coverage reflects created cards', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/learning/insights/coverage' });
    expect((res.json() as { data: { cards: number } }).data.cards).toBeGreaterThanOrEqual(1);
  });
});
