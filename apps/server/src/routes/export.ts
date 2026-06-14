/**
 * Export routes (F1471, F1478) — the mirror of the import routes.
 *
 *   GET  /export/targets        — list available export formats (F1471)
 *   POST /export/:target        — harvest notes (all / notebook / FQL query) and
 *                                 bundle them in the chosen format, to a server
 *                                 directory or a `.zip` (F1478 selective).
 */

import path from 'node:path';
import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import {
  bundleToZip,
  harvestNotes,
  runExport,
  writeFilesToDir,
  type HarvestOptions,
} from '../export/index.js';

registerRoute({ method: 'GET', path: '/export/targets', summary: 'List export formats (F1471)' });
registerRoute({
  method: 'POST',
  path: '/export/:target',
  summary: 'Export notes in a format, scoped by FQL/notebook (F1471/F1478)',
});

const targetParams = z.object({ target: z.string().min(1) });

const exportBody = z.object({
  /** FQL query selecting which notes to export (F1478). */
  query: z.string().max(2000).optional(),
  /** Restrict to one notebook. */
  notebookId: z.string().min(1).optional(),
  /** 'dir' (default) writes a folder under <dataDir>/exports; 'zip' writes one archive. */
  format: z.enum(['dir', 'zip']).optional(),
  /** Cap on notes harvested. */
  limit: z.number().int().min(1).max(50_000).optional(),
});

export const exportRoutes: FastifyPluginAsync = async (app) => {
  app.get('/export/targets', async () => ({ data: app.exporters.list() }));

  app.post('/export/:target', async (request) => {
    const { target } = parseWith(targetParams, request.params, 'params');
    const body = parseWith(exportBody, request.body, 'body');
    const exporter = app.exporters.create(target); // throws VALIDATION on unknown target

    const harvestOpts: HarvestOptions = {
      ...(body.query !== undefined ? { query: body.query } : {}),
      ...(body.notebookId !== undefined ? { notebookId: body.notebookId } : {}),
      ...(body.limit !== undefined ? { limit: body.limit } : {}),
    };
    const notes = harvestNotes(app.db, app.dataDir, harvestOpts);
    const files = await runExport(exporter, notes);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportsRoot = path.join(app.dataDir, 'exports');
    fs.mkdirSync(exportsRoot, { recursive: true });

    if (body.format === 'zip') {
      const zip = bundleToZip(files);
      const zipPath = path.join(exportsRoot, `${target}-${stamp}.zip`);
      fs.writeFileSync(zipPath, zip);
      return {
        data: {
          target,
          notes: notes.length,
          files: files.length,
          bytes: zip.length,
          path: zipPath,
        },
      };
    }

    const destDir = path.join(exportsRoot, `${target}-${stamp}`);
    const result = writeFilesToDir(files, destDir);
    return { data: { ...result, target, notes: notes.length } };
  });
};
