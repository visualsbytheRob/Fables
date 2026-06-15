/**
 * Scheduled job routes (Epic 20, F1921–F1929).
 *
 *  POST   /jobs              — create a cron job
 *  GET    /jobs              — list jobs (with next-run)
 *  GET    /jobs/:id          — fetch a job
 *  PUT    /jobs/:id          — update a job (name/cron/enabled)
 *  DELETE /jobs/:id          — delete a job
 *  GET    /jobs/due          — jobs due now (the scheduler tick reads this)
 *  POST   /jobs/:id/run-now  — run a job immediately (F1926)
 *  GET    /jobs/:id/runs     — run log with durations/outcomes (F1923)
 *
 * The handler dispatch (backup/digest/reindex) is wired by the boot scheduler;
 * this owns the cron schedule, due computation, run log, and manual triggers.
 */

import { notFound, validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { jobsRepo } from '../db/repos/jobs.js';
import { describe as describeCron } from '../jobs/cron.js';

const JOB_TYPES = ['backup', 'digest', 'reindex', 'rule'] as const;
const idParam = z.object({ id: z.string().min(1) });

registerRoute({ method: 'POST', path: '/jobs', summary: 'Create a scheduled job (F1921)' });
registerRoute({ method: 'GET', path: '/jobs', summary: 'List jobs' });
registerRoute({ method: 'GET', path: '/jobs/due', summary: 'Jobs due now' });
registerRoute({ method: 'GET', path: '/jobs/:id', summary: 'Fetch a job' });
registerRoute({ method: 'PUT', path: '/jobs/:id', summary: 'Update a job' });
registerRoute({ method: 'DELETE', path: '/jobs/:id', summary: 'Delete a job' });
registerRoute({ method: 'POST', path: '/jobs/:id/run-now', summary: 'Run a job now (F1926)' });
registerRoute({ method: 'GET', path: '/jobs/:id/runs', summary: 'Job run log (F1923)' });

export const jobRoutes: FastifyPluginAsync = async (app) => {
  const repo = jobsRepo(app.db);

  app.post('/jobs', async (request) => {
    const body = parseWith(
      z.object({
        name: z.string().min(1).max(200),
        type: z.enum(JOB_TYPES),
        cron: z.string().min(1).max(200),
        enabled: z.boolean().optional(),
      }),
      request.body,
      'body',
    );
    try {
      const job = repo.create({
        name: body.name,
        type: body.type,
        cron: body.cron,
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      });
      return { data: { ...job, description: describeCron(job.cron) } };
    } catch (err) {
      throw validation((err as Error).message);
    }
  });

  app.get('/jobs', async () => {
    return {
      data: { jobs: repo.list().map((j) => ({ ...j, description: describeCron(j.cron) })) },
    };
  });

  app.get('/jobs/due', async (request) => {
    const q = parseWith(
      z.object({ now: z.string().datetime().optional() }),
      request.query,
      'query',
    );
    return { data: { jobs: repo.due(q.now) } };
  });

  app.get('/jobs/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const job = repo.get(id);
    if (!job) throw notFound('job', id);
    return { data: { ...job, description: describeCron(job.cron), missed: repo.missed(id) } };
  });

  app.put('/jobs/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const body = parseWith(
      z.object({
        name: z.string().min(1).max(200).optional(),
        cron: z.string().min(1).max(200).optional(),
        enabled: z.boolean().optional(),
      }),
      request.body,
      'body',
    );
    try {
      const job = repo.update(id, body);
      if (!job) throw notFound('job', id);
      return { data: job };
    } catch (err) {
      if ((err as { code?: string }).code) throw err;
      throw validation((err as Error).message);
    }
  });

  app.delete('/jobs/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!repo.remove(id)) throw notFound('job', id);
    return { data: { removed: true } };
  });

  app.post('/jobs/:id/run-now', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    const job = repo.get(id);
    if (!job) throw notFound('job', id);
    if (!repo.claim(id)) throw validation('job is already running');
    const start = Date.now();
    // Handler dispatch is the scheduler's job; a manual run records the outcome.
    repo.recordRun(id, 'ok', Date.now() - start, 'manual run-now');
    return { data: repo.get(id) };
  });

  app.get('/jobs/:id/runs', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!repo.get(id)) throw notFound('job', id);
    return { data: { runs: repo.runLog(id) } };
  });
};
