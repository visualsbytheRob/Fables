/**
 * Import-framework routes (F1401 dry-run/run, F1406 collisions, F1407 provenance,
 * F1408 rollback, F1409 source listing).
 *
 * Source-agnostic: `/import/:source/*` resolves the adapter through the importer
 * registry, so every importer is reachable the moment it registers. Batches,
 * provenance, and rollback work for any source.
 */

import type { FastifyPluginAsync } from 'fastify';
import { notFound } from '@fables/core';
import type { NoteId } from '@fables/core';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { notesRepo } from '../db/repos/notes.js';
import {
  dryRun,
  importBatchesRepo,
  normalizeRules,
  rollbackImport,
  runImport,
} from '../import/framework/index.js';

registerRoute({
  method: 'GET',
  path: '/import/sources',
  summary: 'List available importers (F1409)',
});
registerRoute({
  method: 'POST',
  path: '/import/:source/dry-run',
  summary: 'Dry-run an import: report without writing (F1401)',
});
registerRoute({
  method: 'POST',
  path: '/import/:source/run',
  summary: 'Run an import (F1401/F1406)',
});
registerRoute({ method: 'GET', path: '/import/batches', summary: 'List import batches' });
registerRoute({ method: 'GET', path: '/import/batches/:id', summary: 'Get an import batch' });
registerRoute({
  method: 'POST',
  path: '/import/batches/:id/rollback',
  summary: 'Undo an entire import batch (F1408)',
});
registerRoute({
  method: 'GET',
  path: '/notes/:id/provenance',
  summary: 'Where an imported note came from (F1407)',
});

const sourceParams = z.object({ source: z.string().min(1) });
const idParams = z.object({ id: z.string().min(1) });

const rulesSchema = z
  .object({
    notebooks: z.enum(['preserve', 'flat']).optional(),
    tagPrefix: z.string().max(60).optional(),
    collisions: z.enum(['skip', 'rename', 'merge']).optional(),
    rootNotebookId: z.string().min(1).optional(),
  })
  .optional();

const importBody = z.object({
  /** Source-specific input (path, uploaded id, …) — validated by the adapter. */
  input: z.unknown(),
  rules: rulesSchema,
  /** Resume an interrupted batch (F1405). */
  batchId: z.string().min(1).optional(),
});

export const importFrameworkRoutes: FastifyPluginAsync = async (app) => {
  app.get('/import/sources', async () => ({ data: app.importers.list() }));

  app.post('/import/:source/dry-run', async (request) => {
    const { source } = parseWith(sourceParams, request.params, 'params');
    const body = parseWith(importBody, request.body, 'body');
    const adapter = app.importers.create(source, body.input);
    const rules = normalizeRules(body.rules);
    return { data: await dryRun(app.db, adapter, rules) };
  });

  app.post('/import/:source/run', async (request) => {
    const { source } = parseWith(sourceParams, request.params, 'params');
    const body = parseWith(importBody, request.body, 'body');
    const adapter = app.importers.create(source, body.input);
    const rules = normalizeRules(body.rules);
    return {
      data: await runImport(app.db, app.dataDir, adapter, rules, {
        ...(body.batchId !== undefined ? { batchId: body.batchId } : {}),
      }),
    };
  });

  app.get('/import/batches', async () => ({ data: importBatchesRepo(app.db).list() }));

  app.get('/import/batches/:id', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    const batch = importBatchesRepo(app.db).get(id);
    if (!batch) throw notFound('ImportBatch', id);
    return { data: batch };
  });

  app.post('/import/batches/:id/rollback', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    return { data: rollbackImport(app.db, id) };
  });

  app.get('/notes/:id/provenance', async (request) => {
    const { id } = parseWith(idParams, request.params, 'params');
    if (!notesRepo(app.db).get(id as NoteId)) throw notFound('Note', id);
    return { data: importBatchesRepo(app.db).provenanceForNote(id) };
  });
};
