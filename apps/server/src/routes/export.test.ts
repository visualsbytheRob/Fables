/**
 * Export route tests (F1471/F1478) — list targets, and run an FQL-scoped export
 * to a directory and to a zip on the live app.
 */

import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { createNote } from '../services/notes.js';
import { tagsRepo } from '../db/repos/tags.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const nb = notebooksRepo(app.db).create({ name: 'Travel' });
  const note = createNote(app.db, {
    notebookId: nb.id,
    title: 'Barcelona',
    body: 'Gaudí everywhere',
  });
  tagsRepo(app.db).linkNote(note.id, tagsRepo(app.db).ensure('trip').id, false);
  createNote(app.db, { notebookId: nb.id, title: 'Untagged', body: 'no tag' });
});

afterAll(async () => {
  await app.close();
});

describe('export routes', () => {
  it('lists all registered targets (F1471)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/export/targets' });
    expect(res.statusCode).toBe(200);
    const names = (res.json() as { data: { name: string }[] }).data.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'json',
        'obsidian',
        'notion-md',
        'logseq',
        'static-site',
        'pdf-book',
      ]),
    );
  });

  it('exports an FQL-scoped selection to a directory (F1478)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/export/obsidian',
      payload: { query: 'tag:trip' },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { notes: number; files: number; path: string } }).data;
    expect(data.notes).toBe(1); // only the tagged note
    expect(fs.existsSync(data.path)).toBe(true);
  });

  it('exports everything as a zip', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/export/json',
      payload: { format: 'zip' },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { path: string; bytes: number } }).data;
    expect(data.path.endsWith('.zip')).toBe(true);
    expect(data.bytes).toBeGreaterThan(0);
  });

  it('422s an unknown target', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/export/nope', payload: {} });
    expect(res.statusCode).toBe(422);
  });
});
