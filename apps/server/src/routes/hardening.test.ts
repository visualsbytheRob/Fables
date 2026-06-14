/**
 * Hardening regression suite (F1270).
 *
 * Belt-and-suspenders checks that the security posture is actually WIRED into the
 * live app (not merely unit-tested in isolation): the SSRF guard rejects private
 * targets on the real URL-ingest path, and the hardening response headers are
 * present. If a refactor silently drops one of these, this suite fails.
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

/** Poll a background ingest job until it leaves the running/queued state. */
async function waitForJob(id: string): Promise<{ status: string; error: string | null }> {
  for (let i = 0; i < 40; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/ingest/jobs/${id}` });
    const job = (res.json() as { data: { status: string; error: string | null } }).data;
    if (job.status === 'done' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('ingest job did not settle in time');
}

describe('SSRF guard is wired into /ingest (F1268/F1270)', () => {
  it('fails an ingest job that targets the cloud-metadata address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest',
      payload: { url: 'http://169.254.169.254/latest/meta-data/' },
    });
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { data: { id: string } }).data.id;
    const job = await waitForJob(id);
    expect(job.status).toBe('failed');
    expect(job.error ?? '').toMatch(/private|reserved|resolve/i);
  });

  it('fails an ingest job that targets a loopback address', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest',
      payload: { url: 'http://127.0.0.1:9999/secret' },
    });
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { data: { id: string } }).data.id;
    const job = await waitForJob(id);
    expect(job.status).toBe('failed');
    expect(job.error ?? '').toMatch(/private|reserved/i);
  });
});

describe('hardening headers present on the live app (F1269/F1270)', () => {
  it('ships nosniff + frame-options + CSP on a normal response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(String(res.headers['content-security-policy'])).toContain("object-src 'none'");
  });
});
