/**
 * Embedding/linking tests (F1562 deep links, F1563 placements, F1567 search) +
 * the interop/svg/board/placement routes.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { canvasRepo } from '../db/repos/canvas.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { createNote } from '../services/notes.js';
import { tagsRepo } from '../db/repos/tags.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import {
  decodeCanvasDeepLink,
  encodeCanvasDeepLink,
  noteCanvasPlacements,
  searchCanvasObjects,
} from './embedding.js';

describe('deep links (F1562)', () => {
  it('round-trips a canvas id and region', () => {
    const link = encodeCanvasDeepLink('cnv_1', { minX: 0, minY: 0, maxX: 100, maxY: 50 });
    expect(link).toBe('canvas/cnv_1#region=0,0,100,50');
    expect(decodeCanvasDeepLink(link)).toEqual({
      canvasId: 'cnv_1',
      region: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    });
    expect(decodeCanvasDeepLink('canvas/cnv_2')).toEqual({ canvasId: 'cnv_2' });
    expect(decodeCanvasDeepLink('nonsense')).toBeNull();
  });
});

describe('placements + search (F1563/F1567)', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
  });
  afterEach(() => db.close());

  it('finds where a note is placed and searches object text', () => {
    const repo = canvasRepo(db);
    const a = repo.create('Board A');
    const b = repo.create('Board B');
    repo.replaceObjects(a.id, [
      { kind: 'note', x: 0, y: 0, width: 10, height: 10, data: { noteId: 'n1' } },
      { kind: 'text', x: 0, y: 0, width: 10, height: 10, data: { text: 'a brilliant idea' } },
    ]);
    repo.replaceObjects(b.id, [
      { kind: 'note', x: 0, y: 0, width: 10, height: 10, data: { noteId: 'n1' } },
    ]);

    const placements = noteCanvasPlacements(db, 'n1');
    expect(placements.map((p) => p.canvasId).sort()).toEqual([a.id, b.id].sort());

    const hits = searchCanvasObjects(db, 'brilliant');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toContain('brilliant');
  });
});

describe('routes: import, svg, board', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('imports an Obsidian Canvas onto a canvas (F1594)', async () => {
    const id = (
      (
        await app.inject({ method: 'POST', url: '/api/v1/canvas', payload: { name: 'X' } })
      ).json() as {
        data: { id: string };
      }
    ).data.id;
    const obsidian = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 60, text: 'hello' },
        { id: 'b', type: 'file', x: 200, y: 0, width: 100, height: 60, file: 'Note.md' },
      ],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/canvas/${id}/import`,
      payload: { format: 'obsidian', source: obsidian },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { objects: number; edges: number } }).data).toEqual({
      objects: 2,
      edges: 1,
    });

    const svg = await app.inject({ method: 'GET', url: `/api/v1/canvas/${id}/svg` });
    expect(svg.statusCode).toBe(200);
    expect(svg.body).toContain('<svg');
  });

  it('builds a board grouping notes by tag (F1551)', async () => {
    const nb = notebooksRepo(app.db).create({ name: 'Work' });
    const n = createNote(app.db, { notebookId: nb.id, title: 'Task', body: 'do it' });
    tagsRepo(app.db).linkNote(n.id, tagsRepo(app.db).ensure('urgent').id, false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/board',
      payload: { query: 'tag:urgent', groupBy: 'tag' },
    });
    expect(res.statusCode).toBe(200);
    const board = (res.json() as { data: { columns: { key: string; count: number }[] } }).data;
    expect(board.columns.some((c) => c.key === 'urgent' && c.count === 1)).toBe(true);
  });
});
