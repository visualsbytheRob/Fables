/**
 * Read-along route tests (Epic 17, F1642/F1646/F1647).
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

describe('POST /readalong/align (F1647 fallback)', () => {
  it('estimates word + sentence timings for arbitrary note text (F1646)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/readalong/align',
      payload: { text: 'The forest was quiet. A twig snapped.', totalMs: 6000 },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as {
        data: {
          words: { startMs: number }[];
          sentences: unknown[];
          totalMs: number;
          source: string;
        };
      }
    ).data;
    expect(data.source).toBe('estimated');
    expect(data.words.length).toBe(7);
    expect(data.sentences.length).toBe(2);
    expect(data.totalMs).toBe(6000);
  });
});

describe('POST /readalong/align (F1642 engine boundaries)', () => {
  it('uses provided word boundaries when present', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/readalong/align',
      payload: {
        text: 'one two',
        totalMs: 0,
        boundaries: [
          { index: 0, startMs: 0, endMs: 200 },
          { index: 1, startMs: 200, endMs: 500 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { source: string; totalMs: number } }).data;
    expect(data.source).toBe('engine');
    expect(data.totalMs).toBe(500);
  });
});
