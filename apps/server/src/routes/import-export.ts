import { notFound, type NotebookId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { importJobsRepo } from '../db/repos/import-jobs.js';
import { exportVault, validateExportDir } from '../services/export.js';
import { runImportJob, scanImport, startImportJob, validateImportDir } from '../services/import.js';

const scanBodySchema = z.object({ path: z.string().min(1) });

const runBodySchema = z.object({
  path: z.string().min(1),
  notebookId: z.string().min(1).optional(),
  collisions: z.enum(['skip', 'rename', 'merge']).default('rename'),
});

const jobParamsSchema = z.object({ id: z.string().min(1) });

const exportQuerySchema = z.object({ path: z.string().min(1) });

registerRoute({
  method: 'POST',
  path: '/import/scan',
  summary: 'Dry-run scan of a server-local markdown folder',
  body: scanBodySchema,
});
registerRoute({
  method: 'POST',
  path: '/import/run',
  summary: 'Import a markdown folder (async job, 202 + jobId)',
  body: runBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/import/jobs/:id',
  summary: 'Poll an import job (progress, counters, per-file errors)',
  params: jobParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/export/vault',
  summary: 'Export the vault to a server-local directory (manifest returned)',
  query: exportQuerySchema,
});

export const importExportRoutes: FastifyPluginAsync = async (app) => {
  app.post('/import/scan', async (request) => {
    const { path } = parseWith(scanBodySchema, request.body, 'body');
    return { data: scanImport(app.db, validateImportDir(path)) };
  });

  app.post('/import/run', async (request, reply) => {
    const body = parseWith(runBodySchema, request.body, 'body');
    const root = validateImportDir(body.path);
    const opts = {
      root,
      collisions: body.collisions,
      ...(body.notebookId !== undefined ? { notebookId: body.notebookId as NotebookId } : {}),
    };
    const job = startImportJob(app.db, opts);
    // Fire-and-forget: the batch loop yields to the event loop so progress
    // polls stay responsive; failures land on the job row, never the process.
    void runImportJob(app.db, app.dataDir, job.id, opts).catch((error: unknown) => {
      request.log.error({ err: error, jobId: job.id }, 'import job crashed');
    });
    reply.status(202);
    return { data: job };
  });

  app.get('/import/jobs/:id', async (request) => {
    const { id } = parseWith(jobParamsSchema, request.params, 'params');
    const job = importJobsRepo(app.db).get(id);
    if (!job) throw notFound('Import job', id);
    return { data: job };
  });

  app.get('/export/vault', async (request) => {
    const { path } = parseWith(exportQuerySchema, request.query, 'query');
    const dest = validateExportDir(path, app.dataDir);
    return { data: exportVault(app.db, app.dataDir, dest) };
  });
};
