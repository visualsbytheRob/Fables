import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let notebookId: string;

async function createSaved(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/v1/saved-queries', payload });
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const nb = await app.inject({
    method: 'POST',
    url: '/api/v1/notebooks',
    payload: { name: 'Inbox' },
  });
  notebookId = nb.json().data.id;
  for (const [title, body] of [
    ['Pinned Plan', '#work roadmap'],
    ['Loose Idea', 'a thought'],
    ['Work Journal', '#work daily log'],
  ] as const) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: { notebookId, title, body },
    });
    expect(res.statusCode).toBe(201);
  }
});

afterAll(async () => {
  await app.close();
});

describe('saved queries CRUD (F281, F287)', () => {
  it('creates, fetches, updates, and deletes a saved query', async () => {
    const created = await createSaved({
      name: 'Work',
      fql: 'tag:work sort:title',
      icon: 'briefcase',
    });
    expect(created.statusCode).toBe(201);
    const saved = created.json().data;
    expect(saved).toMatchObject({
      name: 'Work',
      fql: 'tag:work sort:title',
      icon: 'briefcase',
      pinned: false,
    });
    expect(saved.id).toMatch(/^sq_/);

    const fetched = await app.inject({ method: 'GET', url: `/api/v1/saved-queries/${saved.id}` });
    expect(fetched.json().data).toEqual(saved);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/saved-queries/${saved.id}`,
      payload: { pinned: true, name: 'Work stuff' },
    });
    expect(patched.json().data).toMatchObject({ name: 'Work stuff', pinned: true });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/saved-queries/${saved.id}`,
    });
    expect(deleted.json().data).toEqual({ id: saved.id, deleted: true });
    const gone = await app.inject({ method: 'GET', url: `/api/v1/saved-queries/${saved.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects saved queries whose FQL cannot parse', async () => {
    const res = await createSaved({ name: 'Broken', fql: 'pinned:perhaps' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
    expect(res.json().error.details.position).toBe(0);
  });

  it('lists pinned queries first, then by name', async () => {
    await createSaved({ name: 'Zebra', fql: 'zebra' });
    await createSaved({ name: 'Apple', fql: 'apple' });
    await createSaved({ name: 'Pinned last alphabetically', fql: 'tag:work', pinned: true });
    const list = await app.inject({ method: 'GET', url: '/api/v1/saved-queries' });
    const names = list.json().data.map((s: { name: string }) => s.name);
    expect(names).toEqual(['Pinned last alphabetically', 'Apple', 'Zebra']);
  });
});

describe('GET /saved-queries/:id/results (F282 server half, F290)', () => {
  it('runs the stored FQL with the standard paginated envelope', async () => {
    const created = await createSaved({ name: 'Work notes', fql: 'tag:work sort:title' });
    const id = created.json().data.id;

    const first = await app.inject({
      method: 'GET',
      url: `/api/v1/saved-queries/${id}/results?limit=1`,
    });
    expect(first.statusCode).toBe(200);
    const page1 = first.json();
    expect(page1.data.map((n: { title: string }) => n.title)).toEqual(['Pinned Plan']);
    expect(page1.warnings).toEqual([]);
    expect(page1.page.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/saved-queries/${id}/results?limit=1&cursor=${page1.page.nextCursor}`,
    });
    expect(second.json().data.map((n: { title: string }) => n.title)).toEqual(['Work Journal']);
  });

  it('surfaces warnings from degraded stored queries', async () => {
    const created = await createSaved({ name: 'Degraded', fql: 'work OR' });
    const id = created.json().data.id;
    const res = await app.inject({ method: 'GET', url: `/api/v1/saved-queries/${id}/results` });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toHaveLength(1);
  });

  it('404s for an unknown saved query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/saved-queries/sq_missing/results',
    });
    expect(res.statusCode).toBe(404);
  });
});
