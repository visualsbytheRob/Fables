/**
 * Scheduled job route tests (Epic 20, F1921/F1923/F1926).
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

describe('scheduled jobs (F1921/F1923/F1926)', () => {
  it('creates a cron job with a computed next run + description', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: { name: 'Nightly backup', type: 'backup', cron: '0 3 * * *' },
    });
    expect(res.statusCode).toBe(200);
    const job = (res.json() as { data: { id: string; nextRun: string; description: string } }).data;
    expect(job.nextRun).not.toBeNull();
    expect(job.description.length).toBeGreaterThan(0);

    // Run it now → run log records the outcome.
    const run = await app.inject({ method: 'POST', url: `/api/v1/jobs/${job.id}/run-now` });
    expect((run.json() as { data: { runCount: number } }).data.runCount).toBe(1);

    const log = await app.inject({ method: 'GET', url: `/api/v1/jobs/${job.id}/runs` });
    const runs = (log.json() as { data: { runs: { status: string }[] } }).data.runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('ok');
  });

  it('rejects an invalid cron expression', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: { name: 'Broken', type: 'digest', cron: 'not a cron' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('lists due jobs at a given time', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: { name: 'Hourly reindex', type: 'reindex', cron: '@hourly' },
    });
    // Far in the future → everything scheduled before then is due.
    const due = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/due?now=2099-01-01T00:00:00.000Z',
    });
    expect((due.json() as { data: { jobs: unknown[] } }).data.jobs.length).toBeGreaterThan(0);
  });
});
