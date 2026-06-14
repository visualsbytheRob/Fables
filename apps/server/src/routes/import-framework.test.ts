/**
 * Import-framework route tests (F1401/F1407/F1408/F1409) — registers a synthetic
 * importer on the live app and drives the full HTTP surface: list sources,
 * dry-run, run, provenance, batches, rollback.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { SourceAdapter, StagedDoc } from '../import/framework/index.js';
import { buildTitlesIndex } from '../services/links.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  // Register a synthetic importer whose `input` is the staged-doc array.
  app.importers.register(
    { name: 'synthetic', description: 'test source' },
    (input): SourceAdapter => {
      const docs = input as StagedDoc[];
      return { name: 'synthetic', stage: () => docs };
    },
  );
});

afterAll(async () => {
  await app.close();
});

const docs: StagedDoc[] = [
  {
    sourceId: 'a',
    title: 'RouteAlpha',
    body: 'links to {{link:b}}',
    notebookPath: ['Imported'],
    tags: ['t'],
    assets: [],
    links: [{ targetSourceId: 'b' }],
  },
  {
    sourceId: 'b',
    title: 'RouteBeta',
    body: 'hi',
    notebookPath: [],
    tags: [],
    assets: [],
    links: [],
  },
];

describe('import framework routes', () => {
  it('lists registered sources (F1409)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/import/sources' });
    expect(res.statusCode).toBe(200);
    const list = (res.json() as { data: { name: string }[] }).data;
    expect(list.some((s) => s.name === 'synthetic')).toBe(true);
    // The document importers from this batch are registered too.
    expect(list.some((s) => s.name === 'docx')).toBe(true);
    expect(list.some((s) => s.name === 'ics')).toBe(true);
  });

  it('detects the right importer for a dropped path (F1469)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-route-'));
    try {
      fs.writeFileSync(path.join(tmp, 'cal.ics'), 'BEGIN:VCALENDAR\nEND:VCALENDAR\n');
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/import/detect?path=${encodeURIComponent(path.join(tmp, 'cal.ics'))}`,
      });
      expect(res.statusCode).toBe(200);
      const guesses = (res.json() as { data: { guesses: { source: string }[] } }).data.guesses;
      expect(guesses[0]!.source).toBe('ics');
      // Empty path → empty guesses, not an error.
      const empty = await app.inject({ method: 'GET', url: '/api/v1/import/detect' });
      expect((empty.json() as { data: { guesses: unknown[] } }).data.guesses).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('dry-runs without writing (F1401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/import/synthetic/dry-run',
      payload: { input: docs },
    });
    expect(res.statusCode).toBe(200);
    const report = (res.json() as { data: { totals: { docs: number } } }).data;
    expect(report.totals.docs).toBe(2);
  });

  it('runs an import, then exposes provenance and rolls back (F1407/F1408)', async () => {
    const run = await app.inject({
      method: 'POST',
      url: '/api/v1/import/synthetic/run',
      payload: { input: docs, rules: { collisions: 'rename' } },
    });
    expect(run.statusCode).toBe(200);
    const result = (run.json() as { data: { batchId: string; imported: number } }).data;
    expect(result.imported).toBe(2);

    // The created note carries provenance (look up its id via the live title index).
    const noteId = buildTitlesIndex(app.db).get('routealpha');
    expect(noteId).toBeTruthy();
    const prov = await app.inject({
      method: 'GET',
      url: `/api/v1/notes/${noteId}/provenance`,
    });
    expect((prov.json() as { data: { source: string } }).data.source).toBe('synthetic');

    // Rollback the batch removes the imported notes.
    const undo = await app.inject({
      method: 'POST',
      url: `/api/v1/import/batches/${result.batchId}/rollback`,
    });
    expect(undo.statusCode).toBe(200);
    expect((undo.json() as { data: { notes: number } }).data.notes).toBe(2);

    const batch = await app.inject({
      method: 'GET',
      url: `/api/v1/import/batches/${result.batchId}`,
    });
    expect((batch.json() as { data: { status: string } }).data.status).toBe('rolled_back');
  });

  it('404s an unknown source via validation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/import/nope/dry-run',
      payload: { input: [] },
    });
    expect(res.statusCode).toBe(422);
  });
});
