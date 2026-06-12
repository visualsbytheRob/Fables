import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let notebookId: string;

interface TagJson {
  id: string;
  name: string;
  noteCount?: number;
}

async function createNote(body: string): Promise<{ id: string; rev: number; body: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notes',
    payload: { notebookId, title: 'tagged', body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

async function listTags(): Promise<TagJson[]> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/tags' });
  return res.json().data as TagJson[];
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notebooks',
    payload: { name: 'TagLab' },
  });
  notebookId = res.json().data.id;
});

afterAll(async () => {
  await app.close();
});

describe('inline #tag parsing on save (F152)', () => {
  it('indexes normalized and nested tags from note bodies', async () => {
    await createNote(
      'On #World and #world/characters, but not #123 or `#code` fences:\n```\n#fenced\n```',
    );
    const names = (await listTags()).map((t) => t.name);
    expect(names).toContain('world');
    expect(names).toContain('world/characters');
    expect(names).not.toContain('123');
    expect(names).not.toContain('fenced');
  });

  it('re-syncs links when the body changes, keeping manual tags', async () => {
    const note = await createNote('first #ephemeral tag');
    await app.inject({
      method: 'POST',
      url: '/api/v1/notes/bulk',
      payload: { action: 'tag', noteIds: [note.id], tag: 'manual' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${note.id}`,
      payload: { rev: note.rev, body: 'now #different' },
    });
    expect(res.statusCode).toBe(200);

    const fetched = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}` });
    const names = fetched.json().data.tags.map((t: { name: string }) => t.name);
    expect(names).toContain('different');
    expect(names).toContain('manual'); // bulk-applied tag survives body saves
    expect(names).not.toContain('ephemeral');
  });

  it('counts only live notes per tag', async () => {
    const note = await createNote('#countable');
    await app.inject({ method: 'DELETE', url: `/api/v1/notes/${note.id}` });
    const tag = (await listTags()).find((t) => t.name === 'countable');
    expect(tag?.noteCount).toBe(0);
  });
});

describe('tag CRUD (F151)', () => {
  it('creates tags with normalization and rejects duplicates/invalid names', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      payload: { name: '#Projects/Fables', color: '#ff0000' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.name).toBe('projects/fables');

    const dupe = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      payload: { name: 'projects/fables' },
    });
    expect(dupe.statusCode).toBe(409);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      payload: { name: 'no spaces allowed' },
    });
    expect(invalid.statusCode).toBe(422);
  });

  it('renames a tag and propagates the rename into note bodies', async () => {
    const note = await createNote('about #Dragons and #dragons/fire');
    const tag = (await listTags()).find((t) => t.name === 'dragons')!;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tags/${tag.id}`,
      payload: { name: 'wyverns' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe('wyverns');

    const fetched = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}` });
    // Exact tag renamed; the nested child tag is its own tag and stays.
    expect(fetched.json().data.body).toBe('about #wyverns and #dragons/fire');
    expect(fetched.json().data.rev).toBeGreaterThan(note.rev);
    expect((await listTags()).map((t) => t.name)).not.toContain('dragons');
  });

  it('refuses to rename onto an existing tag', async () => {
    await createNote('#alpha-tag and #beta-tag');
    const tags = await listTags();
    const alpha = tags.find((t) => t.name === 'alpha-tag')!;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tags/${alpha.id}`,
      payload: { name: 'beta-tag' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('deletes a tag and its links', async () => {
    const note = await createNote('#deletable');
    const tag = (await listTags()).find((t) => t.name === 'deletable')!;
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/tags/${tag.id}` });
    expect(res.statusCode).toBe(200);
    const fetched = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}` });
    expect(fetched.json().data.tags.map((t: { name: string }) => t.name)).not.toContain(
      'deletable',
    );
  });
});

describe('merge + orphan cleanup (F158–F159)', () => {
  it('merges a tag into another, rewriting bodies and re-pointing links', async () => {
    const note = await createNote('tracking #foo here');
    await createNote('and #bar there');
    const tags = await listTags();
    const foo = tags.find((t) => t.name === 'foo')!;
    const bar = tags.find((t) => t.name === 'bar')!;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tags/${foo.id}/merge-into/${bar.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.mergedNotes).toBe(1);

    const fetched = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}` });
    expect(fetched.json().data.body).toBe('tracking #bar here');
    expect(fetched.json().data.tags.map((t: { name: string }) => t.name)).toContain('bar');

    const after = await listTags();
    expect(after.map((t) => t.name)).not.toContain('foo');
    expect(after.find((t) => t.name === 'bar')?.noteCount).toBe(2);
  });

  it('404s merges involving unknown tags', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tags/tag_00000000000000000000000000/merge-into/tag_00000000000000000000000001',
    });
    expect(res.statusCode).toBe(404);
  });

  it('cleans up orphan tags (F159)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      payload: { name: 'orphaned-tag' },
    });
    expect(created.statusCode).toBe(201);
    const res = await app.inject({ method: 'POST', url: '/api/v1/tags/cleanup' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.removed).toBeGreaterThanOrEqual(1);
    expect((await listTags()).map((t) => t.name)).not.toContain('orphaned-tag');
  });
});
