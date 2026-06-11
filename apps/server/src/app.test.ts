import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

describe('server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health with version and uptime', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe('ok');
    expect(body.data.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'no route for GET /api/v1/nope', details: null },
    });
  });

  it('rejects invalid configuration loudly', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/invalid configuration/);
  });

  it('closes cleanly (graceful shutdown path)', async () => {
    const temp = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    await expect(temp.close()).resolves.toBeUndefined();
  });
});
