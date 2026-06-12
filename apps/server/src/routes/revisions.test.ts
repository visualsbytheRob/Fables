import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let notebookId: string;

async function createNote(title: string, body: string): Promise<{ id: string; rev: number }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notes',
    payload: { notebookId, title, body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

async function patchNote(id: string, rev: number, fields: Record<string, unknown>): Promise<void> {
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/v1/notes/${id}`,
    payload: { rev, ...fields },
  });
  expect(res.statusCode).toBe(200);
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notebooks',
    payload: { name: 'History' },
  });
  notebookId = res.json().data.id;
});

afterAll(async () => {
  await app.close();
});

describe('revision endpoints (F111–F117)', () => {
  it('snapshots on create and on every content-changing save', async () => {
    const note = await createNote('versioned', 'alpha beta gamma');
    await patchNote(note.id, 0, { body: 'alpha delta gamma' });
    await patchNote(note.id, 1, { pinned: true }); // rev bump, but content unchanged

    const res = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}/revisions` });
    expect(res.statusCode).toBe(200);
    const revisions = res.json().data;
    expect(revisions.map((r: { rev: number }) => r.rev)).toEqual([1, 0]); // no rev-2 snapshot
    expect(revisions[0]).toMatchObject({ wordCount: 3, charCount: 'alpha delta gamma'.length });
    expect(revisions[0].body).toBeUndefined();
  });

  it('fetches a specific revision with its body', async () => {
    const note = await createNote('specific', 'original text');
    await patchNote(note.id, 0, { body: 'changed text' });
    const res = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}/revisions/0` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ rev: 0, body: 'original text' });

    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/notes/${note.id}/revisions/42`,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('404s revision listings for unknown notes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/notes/note_00000000000000000000000000/revisions',
    });
    expect(res.statusCode).toBe(404);
  });

  it('restores an old revision as a brand-new head (F115)', async () => {
    const note = await createNote('restorable', 'the first draft');
    await patchNote(note.id, 0, { body: 'the second draft' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/notes/${note.id}/revisions/0/restore`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ body: 'the first draft', rev: 2 });

    const list = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}/revisions` });
    expect(list.json().data.map((r: { rev: number }) => r.rev)).toEqual([2, 1, 0]);
  });

  it('computes a word-level diff between two revisions (F119)', async () => {
    const note = await createNote('diffable', 'alpha beta gamma');
    await patchNote(note.id, 0, { body: 'alpha delta gamma' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/notes/${note.id}/revisions/1/diff?against=0`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      noteId: note.id,
      from: 0,
      to: 1,
      ops: [
        { op: 'equal', text: 'alpha ' },
        { op: 'del', text: 'beta' },
        { op: 'add', text: 'delta' },
        { op: 'equal', text: ' gamma' },
      ],
    });
  });

  it('requires a valid ?against revision for diffs', async () => {
    const note = await createNote('diff-errors', 'text');
    const missingQuery = await app.inject({
      method: 'GET',
      url: `/api/v1/notes/${note.id}/revisions/0/diff`,
    });
    expect(missingQuery.statusCode).toBe(422);
    const missingRev = await app.inject({
      method: 'GET',
      url: `/api/v1/notes/${note.id}/revisions/0/diff?against=9`,
    });
    expect(missingRev.statusCode).toBe(404);
  });
});
