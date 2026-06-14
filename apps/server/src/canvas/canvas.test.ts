/**
 * Canvas tests (F1510) — snapping geometry (F1505), the undo/group/lock editor
 * (F1506/F1507), and persistence + routes (F1502/F1508).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { canvasRepo } from '../db/repos/canvas.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { snap } from './geometry.js';
import { CanvasEditor } from './editor.js';
import type { CanvasObject } from './types.js';

function obj(p: Partial<CanvasObject> & { id: string }): CanvasObject {
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

describe('snapping (F1505)', () => {
  it('snaps a left edge to a neighbour within threshold', () => {
    const moving = { x: 103, y: 200, width: 100, height: 60 };
    const other = { x: 100, y: 0, width: 100, height: 60 };
    const res = snap(moving, [other], { threshold: 6 });
    expect(res.x).toBe(100); // left edge snapped from 103 → 100
    expect(res.guides.some((g) => g.axis === 'x' && g.at === 100)).toBe(true);
  });

  it('snaps to a grid when enabled', () => {
    const res = snap({ x: 7, y: 11, width: 50, height: 50 }, [], { grid: 10, threshold: 6 });
    expect(res.x).toBe(10);
    expect(res.y).toBe(10);
  });

  it('leaves a position alone when nothing is near', () => {
    const res = snap({ x: 500, y: 500, width: 10, height: 10 }, [
      { x: 0, y: 0, width: 5, height: 5 },
    ]);
    expect(res).toMatchObject({ x: 500, y: 500, guides: [] });
  });
});

describe('editor undo/redo + group/lock (F1506/F1507)', () => {
  it('moves and undoes/redoes exactly', () => {
    const ed = new CanvasEditor([obj({ id: 'a', x: 0, y: 0 })]);
    ed.move(['a'], 50, 30);
    expect(ed.get('a')).toMatchObject({ x: 50, y: 30 });
    ed.undo();
    expect(ed.get('a')).toMatchObject({ x: 0, y: 0 });
    ed.redo();
    expect(ed.get('a')).toMatchObject({ x: 50, y: 30 });
  });

  it('does not move locked objects', () => {
    const ed = new CanvasEditor([obj({ id: 'a', locked: true })]);
    ed.move(['a'], 50, 0);
    expect(ed.get('a')!.x).toBe(0);
  });

  it('groups and ungroups with undo', () => {
    const ed = new CanvasEditor([obj({ id: 'a' }), obj({ id: 'b' })]);
    ed.group(['a', 'b'], 'g1');
    expect(ed.get('a')!.groupId).toBe('g1');
    ed.undo();
    expect(ed.get('a')!.groupId).toBeNull();
  });

  it('add/remove are reversible and a new action clears redo', () => {
    const ed = new CanvasEditor();
    ed.add(obj({ id: 'a' }));
    ed.add(obj({ id: 'b' }));
    ed.remove(['a']);
    expect(ed.size).toBe(1);
    ed.undo(); // restore a
    expect(ed.size).toBe(2);
    ed.add(obj({ id: 'c' })); // new action — redo branch gone
    expect(ed.canRedo).toBe(false);
  });

  it('bringToFront raises above all, preserving relative order', () => {
    const ed = new CanvasEditor([
      obj({ id: 'a', z: 0 }),
      obj({ id: 'b', z: 1 }),
      obj({ id: 'c', z: 2 }),
    ]);
    ed.bringToFront(['a', 'b']);
    expect(ed.get('a')!.z).toBeGreaterThan(ed.get('c')!.z);
    expect(ed.get('b')!.z).toBeGreaterThan(ed.get('a')!.z); // a was below b → order kept
  });
});

describe('persistence (F1502/F1508)', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
  });
  afterEach(() => db.close());

  it('round-trips objects and queries a region', () => {
    const repo = canvasRepo(db);
    const canvas = repo.create('Board');
    repo.replaceObjects(canvas.id, [
      { kind: 'note', x: 0, y: 0, width: 50, height: 50, data: { noteId: 'n1' } },
      { kind: 'shape', x: 500, y: 500, width: 50, height: 50 },
    ]);
    expect(repo.listObjects(canvas.id)).toHaveLength(2);
    const near = repo.objectsInRegion(canvas.id, { minX: -10, minY: -10, maxX: 100, maxY: 100 });
    expect(near).toHaveLength(1);
    expect(near[0]!.data['noteId']).toBe('n1');
  });

  it('autosave replaces the whole set', () => {
    const repo = canvasRepo(db);
    const canvas = repo.create('Board');
    repo.replaceObjects(canvas.id, [{ kind: 'note', x: 0, y: 0, width: 10, height: 10 }]);
    repo.replaceObjects(canvas.id, [
      { kind: 'text', x: 1, y: 1, width: 10, height: 10 },
      { kind: 'text', x: 2, y: 2, width: 10, height: 10 },
    ]);
    const objs = repo.listObjects(canvas.id);
    expect(objs).toHaveLength(2);
    expect(objs.every((o) => o.kind === 'text')).toBe(true);
  });
});

describe('canvas routes', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('creates, autosaves, reads back, and deletes a canvas', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/canvas',
      payload: { name: 'My Board' },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;

    const save = await app.inject({
      method: 'PUT',
      url: `/api/v1/canvas/${id}/objects`,
      payload: { objects: [{ kind: 'sticky', x: 10, y: 10, width: 80, height: 80 }] },
    });
    expect((save.json() as { data: { saved: number } }).data.saved).toBe(1);

    const read = await app.inject({ method: 'GET', url: `/api/v1/canvas/${id}` });
    const body = read.json() as { data: { canvas: { name: string }; objects: unknown[] } };
    expect(body.data.canvas.name).toBe('My Board');
    expect(body.data.objects).toHaveLength(1);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/canvas/${id}` });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: 'GET', url: `/api/v1/canvas/${id}` });
    expect(gone.statusCode).toBe(404);
  });
});
