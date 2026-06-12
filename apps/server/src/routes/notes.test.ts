import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { purgeExpiredTrash } from '../jobs.js';

let app: FastifyInstance;
let notebookId: string;

interface NoteJson {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  pinned: boolean;
  trashedAt: string | null;
  rev: number;
}

async function createNote(fields: Record<string, unknown> = {}): Promise<NoteJson> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notes',
    payload: { notebookId, title: 'untitled', ...fields },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as NoteJson;
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notebooks',
    payload: { name: 'Lab' },
  });
  notebookId = res.json().data.id;
});

afterAll(async () => {
  await app.close();
});

describe('note CRUD (F101–F104)', () => {
  it('creates a note with title, body, and notebook', async () => {
    const note = await createNote({ title: 'Hello', body: 'world' });
    expect(note).toMatchObject({
      title: 'Hello',
      body: 'world',
      notebookId,
      rev: 0,
      pinned: false,
    });
  });

  it('rejects creation in an unknown notebook', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: { notebookId: 'nb_00000000000000000000000000' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('rejects invalid payloads with VALIDATION', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/notes', payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('fetches a single note with its tags', async () => {
    const note = await createNote({ body: 'tagged with #fetch-test' });
    const res = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(note.id);
    expect(res.json().data.tags.map((t: { name: string }) => t.name)).toEqual(['fetch-test']);
  });

  it('updates with a matching rev and bumps it', async () => {
    const note = await createNote();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${note.id}`,
      payload: { rev: 0, title: 'renamed', pinned: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ title: 'renamed', pinned: true, rev: 1 });
  });

  it('returns 409 CONFLICT on a stale rev', async () => {
    const note = await createNote();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${note.id}`,
      payload: { rev: 0, title: 'first writer wins' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${note.id}`,
      payload: { rev: 0, title: 'stale writer' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
    expect(res.json().error.details).toMatchObject({ expectedRev: 0, actualRev: 1 });
  });

  it('requires rev on PATCH', async () => {
    const note = await createNote();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${note.id}`,
      payload: { title: 'no rev' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects note bodies past the 1 MB guard with PAYLOAD_TOO_LARGE (F118)', async () => {
    const note = await createNote();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${note.id}`,
      payload: { rev: 0, body: 'a'.repeat(1024 * 1024 + 1) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('note listing (F103)', () => {
  let listNotebookId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notebooks',
      payload: { name: 'ListLab' },
    });
    listNotebookId = res.json().data.id;
    for (const title of ['banana', 'apple', 'cherry']) {
      await createNote({ notebookId: listNotebookId, title });
    }
  });

  it('filters by notebook and sorts by title with cursor pagination', async () => {
    const page1 = await app.inject({
      method: 'GET',
      url: `/api/v1/notes?notebookId=${listNotebookId}&sort=title&limit=2`,
    });
    const body1 = page1.json();
    expect(body1.data.map((n: { title: string }) => n.title)).toEqual(['apple', 'banana']);
    expect(body1.page.nextCursor).toBe(body1.data[1].id);

    const page2 = await app.inject({
      method: 'GET',
      url: `/api/v1/notes?notebookId=${listNotebookId}&sort=title&limit=2&cursor=${body1.page.nextCursor}`,
    });
    const body2 = page2.json();
    expect(body2.data.map((n: { title: string }) => n.title)).toEqual(['cherry']);
    expect(body2.page.nextCursor).toBeNull();
  });

  it('sorts by created descending', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/notes?notebookId=${listNotebookId}&sort=created`,
    });
    const titles = res.json().data.map((n: { title: string }) => n.title);
    expect(titles).toEqual(['cherry', 'apple', 'banana']);
  });

  it('rejects unknown cursors and bad sorts', async () => {
    const bad = await app.inject({ method: 'GET', url: '/api/v1/notes?cursor=note_nope' });
    expect(bad.statusCode).toBe(422);
    const badSort = await app.inject({ method: 'GET', url: '/api/v1/notes?sort=sideways' });
    expect(badSort.statusCode).toBe(422);
  });
});

describe('trash lifecycle (F105–F107)', () => {
  it('soft-deletes, hides from listings, shows in trash, restores', async () => {
    const note = await createNote({ title: 'doomed' });
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/notes/${note.id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.trashedAt).not.toBeNull();

    const list = await app.inject({ method: 'GET', url: `/api/v1/notes?notebookId=${notebookId}` });
    expect(list.json().data.some((n: { id: string }) => n.id === note.id)).toBe(false);

    const trash = await app.inject({ method: 'GET', url: '/api/v1/trash' });
    expect(trash.json().data.some((n: { id: string }) => n.id === note.id)).toBe(true);

    // Deleting again is idempotent.
    const again = await app.inject({ method: 'DELETE', url: `/api/v1/notes/${note.id}` });
    expect(again.statusCode).toBe(200);

    const restore = await app.inject({ method: 'POST', url: `/api/v1/notes/${note.id}/restore` });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().data.trashedAt).toBeNull();

    const reRestore = await app.inject({ method: 'POST', url: `/api/v1/notes/${note.id}/restore` });
    expect(reRestore.statusCode).toBe(409);
  });

  it('empties the trash on demand', async () => {
    const note = await createNote({ title: 'emptied' });
    await app.inject({ method: 'DELETE', url: `/api/v1/notes/${note.id}` });
    const res = await app.inject({ method: 'POST', url: '/api/v1/trash/empty' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.purged).toBeGreaterThanOrEqual(1);
    const gone = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it('auto-purges only notes trashed >30 days ago (F107)', async () => {
    const old = await createNote({ title: 'ancient' });
    const fresh = await createNote({ title: 'recent' });
    await app.inject({ method: 'DELETE', url: `/api/v1/notes/${old.id}` });
    await app.inject({ method: 'DELETE', url: `/api/v1/notes/${fresh.id}` });
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
    app.db.prepare('UPDATE notes SET trashed_at = ? WHERE id = ?').run(thirtyOneDaysAgo, old.id);

    expect(purgeExpiredTrash(app.db)).toBe(1);
    expect((await app.inject({ method: 'GET', url: `/api/v1/notes/${old.id}` })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: 'GET', url: `/api/v1/notes/${fresh.id}` })).statusCode).toBe(
      200,
    );
  });
});

describe('duplicate + bulk (F108–F109)', () => {
  it('duplicates a note preserving body, notebook, and tags', async () => {
    const note = await createNote({ title: 'original', body: 'has #dupe-tag' });
    const res = await app.inject({ method: 'POST', url: `/api/v1/notes/${note.id}/duplicate` });
    expect(res.statusCode).toBe(201);
    const copy = res.json().data;
    expect(copy.id).not.toBe(note.id);
    expect(copy).toMatchObject({ title: 'original (copy)', body: 'has #dupe-tag', notebookId });

    const fetched = await app.inject({ method: 'GET', url: `/api/v1/notes/${copy.id}` });
    expect(fetched.json().data.tags.map((t: { name: string }) => t.name)).toEqual(['dupe-tag']);
  });

  it('bulk-moves notes to another notebook', async () => {
    const target = (
      await app.inject({ method: 'POST', url: '/api/v1/notebooks', payload: { name: 'Target' } })
    ).json().data;
    const a = await createNote({ title: 'bulk-a' });
    const b = await createNote({ title: 'bulk-b' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notes/bulk',
      payload: { action: 'move', noteIds: [a.id, b.id], notebookId: target.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.affected).toBe(2);
    const moved = await app.inject({ method: 'GET', url: `/api/v1/notes/${a.id}` });
    expect(moved.json().data.notebookId).toBe(target.id);
  });

  it('bulk-tags notes without touching their bodies', async () => {
    const a = await createNote({ title: 'tag-me', body: 'unchanged' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notes/bulk',
      payload: { action: 'tag', noteIds: [a.id], tag: 'Bulk-Tagged' },
    });
    expect(res.json().data.affected).toBe(1);
    const fetched = await app.inject({ method: 'GET', url: `/api/v1/notes/${a.id}` });
    expect(fetched.json().data.body).toBe('unchanged');
    expect(fetched.json().data.tags.map((t: { name: string }) => t.name)).toEqual(['bulk-tagged']);
  });

  it('bulk-deletes notes to trash', async () => {
    const a = await createNote({ title: 'bulk-doomed' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notes/bulk',
      payload: { action: 'delete', noteIds: [a.id] },
    });
    expect(res.json().data.affected).toBe(1);
    const fetched = await app.inject({ method: 'GET', url: `/api/v1/notes/${a.id}` });
    expect(fetched.json().data.trashedAt).not.toBeNull();
  });

  it('rolls the whole bulk operation back when any note is missing', async () => {
    const a = await createNote({ title: 'safe' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notes/bulk',
      payload: { action: 'delete', noteIds: [a.id, 'note_00000000000000000000000000'] },
    });
    expect(res.statusCode).toBe(404);
    const fetched = await app.inject({ method: 'GET', url: `/api/v1/notes/${a.id}` });
    expect(fetched.json().data.trashedAt).toBeNull();
  });

  it('validates bulk action requirements', async () => {
    const a = await createNote();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notes/bulk',
      payload: { action: 'move', noteIds: [a.id] },
    });
    expect(res.statusCode).toBe(422);
  });
});
