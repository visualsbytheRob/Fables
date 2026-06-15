/**
 * Scripting console route tests (Epic 20, F1942–F1948).
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

describe('script library (F1942/F1947)', () => {
  it('saves a script and reports its scope check', async () => {
    const created = (
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/scripts',
          payload: {
            name: 'Tagger',
            source: 'await fables.notes.query(""); await fables.notes.create({});',
            scopes: ['notes:read', 'notes:write'],
          },
        })
      ).json() as { data: { id: string } }
    ).data;

    const check = await app.inject({ method: 'GET', url: `/api/v1/scripts/${created.id}/check` });
    expect((check.json() as { data: { ok: boolean } }).data.ok).toBe(true);
  });

  it('rejects an unknown scope on save', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/scripts',
      payload: { name: 'Bad', source: 'noop()', scopes: ['totally:made-up'] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects an invalid cron on save', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/scripts',
      payload: { name: 'Cronny', source: 'noop()', cron: 'not a cron' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('checks arbitrary source without saving (F1946)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/scripts/check',
      payload: { source: 'await fables.notes.create({});', scopes: ['notes:read'] },
    });
    const data = (res.json() as { data: { missingScopes: string[] } }).data;
    expect(data.missingScopes).toEqual(['notes:write']);
  });

  it('serves the example gallery and known scopes', async () => {
    const gallery = await app.inject({ method: 'GET', url: '/api/v1/scripts/gallery' });
    expect(
      (gallery.json() as { data: { scripts: unknown[] } }).data.scripts.length,
    ).toBeGreaterThan(0);
    const scopes = await app.inject({ method: 'GET', url: '/api/v1/scripts/scopes' });
    expect((scopes.json() as { data: { scopes: string[] } }).data.scopes).toContain('notes:write');
  });
});
