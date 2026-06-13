import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let notebookId: string;
let storyId: string;
let entityId: string;

async function post(url: string, payload?: unknown) {
  return app.inject({ method: 'POST', url: `/api/v1${url}`, payload: (payload ?? {}) as object });
}
async function get(url: string) {
  return app.inject({ method: 'GET', url: `/api/v1${url}` });
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  notebookId = (await post('/notebooks', { name: 'Log' })).json().data.id;
  await post('/notes', { notebookId, title: 'First note', body: 'hello' });
  storyId = (await post('/stories', { title: 'Saga' })).json().data.id;
  await post(`/stories/${storyId}/build`);
  await post(`/stories/${storyId}/playthroughs`, { id: 'run1' });
  await post(`/stories/${storyId}/playthroughs/run1/finish`);
  entityId = (await post('/entities', { type: 'character', name: 'Wisp' })).json().data.id;
});

afterAll(async () => {
  await app.close();
});

describe('unified timeline (F651/F652)', () => {
  it('groups events by day and supports type filters', async () => {
    const all = await get('/timeline');
    expect(all.statusCode).toBe(200);
    const groups = all.json().data;
    expect(groups.length).toBeGreaterThan(0);
    const events = groups.flatMap((g: { events: unknown[] }) => g.events);
    const types = new Set(events.map((e: { type: string }) => e.type));
    expect(types.has('notes')).toBe(true);
    expect(types.has('stories')).toBe(true);
    expect(types.has('playthroughs')).toBe(true);

    const onlyNotes = (await get('/timeline?types=notes')).json().data;
    const onlyTypes = new Set(
      onlyNotes
        .flatMap((g: { events: { type: string }[] }) => g.events)
        .map((e: { type: string }) => e.type),
    );
    expect([...onlyTypes]).toEqual(['notes']);
  });

  it('cursor-paginates', async () => {
    const page1 = await get('/timeline?limit=1');
    expect(page1.json().data.flatMap((g: { events: unknown[] }) => g.events)).toHaveLength(1);
    const cursor = page1.json().page.nextCursor;
    expect(cursor).toBeTruthy();
    const page2 = await get(`/timeline?limit=1&cursor=${encodeURIComponent(cursor)}`);
    const e1 = page1.json().data[0].events[0].id;
    const e2 = page2.json().data[0].events[0].id;
    expect(e2).not.toBe(e1);
  });

  it('rejects unknown types', async () => {
    expect((await get('/timeline?types=bogus')).statusCode).toBe(422);
  });
});

describe('chronology + entity timeline (F655/F657)', () => {
  it('reads `# when:` chronology tags', async () => {
    const files = (await get(`/stories/${storyId}/files`)).json().data;
    const entry = files.find((f: { path: string }) => f.path === 'main.fable');
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${storyId}/files/${entry.id}`,
      payload: { source: `# title: Saga\n# when: year 312\nHello\n-> END\n` },
    });
    const chrono = (await get(`/stories/${storyId}/chronology`)).json().data;
    expect(chrono).toEqual([{ when: 'year 312', file: 'main.fable', scene: null }]);
  });

  it('returns entity events', async () => {
    await post(`/stories/${storyId}/playthroughs/run1/encounters`, { entityId });
    const tl = (await get(`/entities/${entityId}/timeline`)).json().data;
    expect(tl.some((e: { type: string }) => e.type === 'encounter')).toBe(true);
  });
});

describe('chronicle export (F659)', () => {
  it('writes a markdown note', async () => {
    const res = await post('/timeline/export', { title: 'My Chronicle' });
    expect(res.statusCode).toBe(201);
    const noteId = res.json().data.noteId;
    const note = (await get(`/notes/${noteId}`)).json().data;
    expect(note.title).toBe('My Chronicle');
    expect(note.body).toContain('# My Chronicle');
    expect(note.body).toMatch(/## \d{4}-\d{2}-\d{2}/);
  });
});
