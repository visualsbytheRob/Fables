/**
 * AI runtime depth route tests (F1306, F1307, F1316, F1317, F1319).
 *
 * No model backend is registered in tests, so generation-dependent endpoints
 * are exercised on their graceful-unavailable path; the management endpoints
 * (queue stats, resource policy, prompt log, overrides) work without a model.
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

describe('GET /ai/queue (F1306)', () => {
  it('reports queue capacity and depth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/queue' });
    const data = (res.json() as { data: { capacity: number; queued: number; running: number } })
      .data;
    expect(data.capacity).toBeGreaterThanOrEqual(1);
    expect(data.queued).toBe(0);
  });
});

describe('POST /ai/resource/evaluate (F1307)', () => {
  it('blocks AI on low battery and explains why', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/resource/evaluate',
      payload: { state: { batteryLevel: 0.1, charging: false } },
    });
    const data = (res.json() as { data: { allowed: boolean; reasons: string[] } }).data;
    expect(data.allowed).toBe(false);
    expect(data.reasons).toContain('low-battery');
  });

  it('honours a custom config override', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/resource/evaluate',
      payload: { state: { batteryLevel: 0.1 }, config: { enabled: false } },
    });
    expect((res.json() as { data: { allowed: boolean } }).data.allowed).toBe(true);
  });
});

describe('prompt log (F1316)', () => {
  it('is off by default and starts empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/prompt-log' });
    const data = (res.json() as { data: { enabled: boolean; entries: unknown[] } }).data;
    expect(data.enabled).toBe(false);
    expect(data.entries).toEqual([]);
  });
});

describe('prompt overrides (F1317)', () => {
  it('lists effective prompts, sets and clears an override', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/ai/prompts' });
    expect((list.json() as { data: { prompts: unknown[] } }).data.prompts.length).toBeGreaterThan(
      5,
    );

    const set = await app.inject({
      method: 'PUT',
      url: '/api/v1/ai/prompts/summarize',
      payload: { system: 'Be very terse.' },
    });
    expect((set.json() as { data: { overridden: boolean } }).data.overridden).toBe(true);

    const clear = await app.inject({ method: 'DELETE', url: '/api/v1/ai/prompts/summarize' });
    expect(clear.statusCode).toBe(200);
  });

  it('rejects an override that drops a required slot', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/ai/prompts/summarize',
      payload: { template: 'no slots at all' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('404s an unknown template id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/ai/prompts/not-a-template',
      payload: { system: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('generation endpoints degrade without a backend (F1305/F1319)', () => {
  it('streaming returns 503 when no AI backend is present', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/stream',
      payload: { prompt: 'hello' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('regression returns 503 when no AI backend is present', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/prompt-regression',
      payload: { cases: [{ id: 'c', promptId: 'summarize', input: 'x', golden: 'y' }] },
    });
    expect(res.statusCode).toBe(503);
  });
});
