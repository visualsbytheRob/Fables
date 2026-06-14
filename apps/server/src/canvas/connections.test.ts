/**
 * Connector tests (F1521/F1523/F1528) — validity rules, real-link materialization,
 * and the edges repo + routes.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { canvasEdgesRepo } from '../db/repos/canvas-edges.js';
import { createNote } from '../services/notes.js';
import { linksRepo } from '../db/repos/links.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { canConnect, materializeConnectorLink } from './connections.js';
import type { CanvasObject } from './types.js';

function card(p: Partial<CanvasObject> & { id: string }): CanvasObject {
  return {
    kind: 'note',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    z: 0,
    rotation: 0,
    locked: false,
    groupId: null,
    data: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...p,
  };
}

describe('connection validity (F1528)', () => {
  it('allows visual lines between anything but rejects semantic links to shapes', () => {
    expect(canConnect('shape', 'image', 'line').allowed).toBe(true);
    expect(canConnect('note', 'note', 'link').allowed).toBe(true);
    expect(canConnect('note', 'shape', 'link').allowed).toBe(false);
    expect(canConnect('group', 'note', 'line').allowed).toBe(false);
  });
});

describe('link materialization (F1523)', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
  });
  afterEach(() => db.close());

  it('a link connector between note cards writes a real graph link', () => {
    const nb = notebooksRepo(db).create({ name: 'NB' });
    const a = createNote(db, { notebookId: nb.id, title: 'Alpha', body: 'start' });
    const b = createNote(db, { notebookId: nb.id, title: 'Beta', body: 'hi' });
    const cardA = card({ id: 'o1', kind: 'note', data: { noteId: a.id } });
    const cardB = card({ id: 'o2', kind: 'note', data: { noteId: b.id } });

    expect(materializeConnectorLink(db, cardA, cardB)).toBe(true);
    // Beta now has Alpha among the notes linking to it.
    expect(linksRepo(db).sourceIdsLinkingTo(b.id)).toContain(a.id);
    // Idempotent: a second connector doesn't double-write.
    expect(materializeConnectorLink(db, cardA, cardB)).toBe(false);
  });
});

describe('edges repo + routes (F1521)', () => {
  it('stores edges via the repo', () => {
    const db = openDb(':memory:');
    migrate(db);
    try {
      const repo = canvasEdgesRepo(db);
      db.prepare(
        "INSERT INTO canvases (id, name, created_at, updated_at) VALUES ('c1','C','t','t')",
      ).run();
      const e = repo.create('c1', { fromId: 'a', toId: 'b', kind: 'line', label: 'rel' });
      expect(repo.list('c1')).toHaveLength(1);
      expect(repo.remove('c1', e.id)).toBe(true);
      expect(repo.list('c1')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  describe('routes', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    });
    afterAll(async () => {
      await app.close();
    });

    it('rejects a semantic link between incompatible cards (422)', async () => {
      const canvas = (
        await app.inject({ method: 'POST', url: '/api/v1/canvas', payload: { name: 'B' } })
      ).json() as { data: { id: string } };
      const id = canvas.data.id;
      await app.inject({
        method: 'PUT',
        url: `/api/v1/canvas/${id}/objects`,
        payload: {
          objects: [
            { id: 'n1', kind: 'note', x: 0, y: 0, width: 10, height: 10 },
            { id: 's1', kind: 'shape', x: 50, y: 0, width: 10, height: 10 },
          ],
        },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/canvas/${id}/edges`,
        payload: { fromId: 'n1', toId: 's1', kind: 'link' },
      });
      expect(res.statusCode).toBe(422);

      const ok = await app.inject({
        method: 'POST',
        url: `/api/v1/canvas/${id}/edges`,
        payload: { fromId: 'n1', toId: 's1', kind: 'line' },
      });
      expect(ok.statusCode).toBe(200);
    });
  });
});
