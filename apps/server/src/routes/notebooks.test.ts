import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;

interface NotebookJson {
  id: string;
  parentId: string | null;
  name: string;
  archived: boolean;
}

async function createNotebook(fields: Record<string, unknown>): Promise<NotebookJson> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/notebooks', payload: fields });
  expect(res.statusCode).toBe(201);
  return res.json().data as NotebookJson;
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

describe('notebook CRUD with nesting (F141)', () => {
  it('creates nested notebooks with icon and color', async () => {
    const parent = await createNotebook({ name: 'Worlds', icon: 'globe', color: '#aabbcc' });
    const child = await createNotebook({ name: 'Aria', parentId: parent.id });
    expect(child.parentId).toBe(parent.id);

    const fetched = await app.inject({ method: 'GET', url: `/api/v1/notebooks/${child.id}` });
    expect(fetched.json().data.parentId).toBe(parent.id);
  });

  it('rejects unknown parents', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notebooks',
      payload: { name: 'orphan', parentId: 'nb_00000000000000000000000000' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('renames and re-parents via PATCH', async () => {
    const a = await createNotebook({ name: 'A' });
    const b = await createNotebook({ name: 'B', parentId: a.id });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notebooks/${b.id}`,
      payload: { name: 'B2', parentId: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ name: 'B2', parentId: null });
  });

  it('prevents cycles, including self-parenting (F150)', async () => {
    const a = await createNotebook({ name: 'CycleA' });
    const b = await createNotebook({ name: 'CycleB', parentId: a.id });
    const c = await createNotebook({ name: 'CycleC', parentId: b.id });

    const self = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notebooks/${a.id}`,
      payload: { parentId: a.id },
    });
    expect(self.statusCode).toBe(409);

    const cycle = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notebooks/${a.id}`,
      payload: { parentId: c.id },
    });
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json().error.code).toBe('CONFLICT');
  });
});

describe('archive flag (F147)', () => {
  it('hides archived notebooks from default views', async () => {
    const nb = await createNotebook({ name: 'Dusty' });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/notebooks/${nb.id}`,
      payload: { archived: true },
    });

    const defaults = await app.inject({ method: 'GET', url: '/api/v1/notebooks' });
    expect(defaults.json().data.some((n: { id: string }) => n.id === nb.id)).toBe(false);

    const all = await app.inject({ method: 'GET', url: '/api/v1/notebooks?includeArchived=true' });
    expect(all.json().data.some((n: { id: string }) => n.id === nb.id)).toBe(true);
  });
});

describe('notebook tree (F141, F146)', () => {
  it('returns a nested tree with live-note counts', async () => {
    const root = await createNotebook({ name: 'TreeRoot' });
    const leaf = await createNotebook({ name: 'TreeLeaf', parentId: root.id });
    await app.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: { notebookId: leaf.id, title: 'counted' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/notebooks/tree' });
    const rootNode = res.json().data.find((n: { id: string }) => n.id === root.id) as {
      noteCount: number;
      children: { id: string; noteCount: number }[];
    };
    expect(rootNode.noteCount).toBe(0);
    expect(rootNode.children.map((c) => c.id)).toEqual([leaf.id]);
    expect(rootNode.children[0]!.noteCount).toBe(1);
  });
});

describe('notebook deletion with re-homing (F149)', () => {
  it('requires a target when notes exist, then moves them', async () => {
    const doomed = await createNotebook({ name: 'Doomed' });
    const haven = await createNotebook({ name: 'Haven' });
    const note = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/notes',
        payload: { notebookId: doomed.id, title: 'refugee' },
      })
    ).json().data;

    const noTarget = await app.inject({ method: 'DELETE', url: `/api/v1/notebooks/${doomed.id}` });
    expect(noTarget.statusCode).toBe(422);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/notebooks/${doomed.id}?moveNotesTo=${haven.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.movedNotes).toBe(1);

    const moved = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}` });
    expect(moved.json().data.notebookId).toBe(haven.id);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/notebooks/${doomed.id}` })).statusCode,
    ).toBe(404);
  });

  it('re-parents children to the deleted notebook’s parent', async () => {
    const grandparent = await createNotebook({ name: 'Gran' });
    const parent = await createNotebook({ name: 'Middle', parentId: grandparent.id });
    const child = await createNotebook({ name: 'Kid', parentId: parent.id });

    const res = await app.inject({ method: 'DELETE', url: `/api/v1/notebooks/${parent.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.reparentedChildren).toBe(1);

    const fetched = await app.inject({ method: 'GET', url: `/api/v1/notebooks/${child.id}` });
    expect(fetched.json().data.parentId).toBe(grandparent.id);
  });

  it('404s on unknown notebooks', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/notebooks/nb_00000000000000000000000000',
    });
    expect(res.statusCode).toBe(404);
  });
});
