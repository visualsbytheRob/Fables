import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let notebookId: string;

interface NoteJson {
  id: string;
  rev: number;
  body: string;
}

interface MentionsJson {
  noteId: string;
  total: number;
  sources: {
    note: { id: string; title: string };
    count: number;
    links: {
      id: string;
      position: number;
      length: number;
      text: string;
      snippet: { text: string; highlightStart: number; highlightEnd: number };
    }[];
  }[];
}

async function createNote(title: string, body = ''): Promise<NoteJson> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notes',
    payload: { notebookId, title, body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

async function mentions(id: string): Promise<MentionsJson> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/notes/${id}/mentions` });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

async function getNote(id: string): Promise<NoteJson> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/notes/${id}` });
  return res.json().data;
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notebooks',
    payload: { name: 'MentionLab' },
  });
  notebookId = res.json().data.id;
});

afterAll(async () => {
  await app.close();
});

describe('unlinked mention detection (F221, F229)', () => {
  it('indexes plain-text title hits on save, excluding code, URLs, and wikilinks', async () => {
    const target = await createNote('Silver Key');
    const source = await createNote(
      'Diary',
      'found the silver key today\n`Silver Key` in code\n[[Silver Key]] linked\nhttps://x.test/Silver-Key',
    );

    const data = await mentions(target.id);
    expect(data.total).toBe(1);
    expect(data.sources[0]!.note.id).toBe(source.id);
    const hit = data.sources[0]!.links[0]!;
    expect(hit.text).toBe('silver key');
    expect(hit.snippet.text.slice(hit.snippet.highlightStart, hit.snippet.highlightEnd)).toBe(
      'silver key',
    );
  });

  it('updates incrementally when the source body changes (F222)', async () => {
    const target = await createNote('Brass Compass');
    const source = await createNote('Pocket', 'carrying the Brass Compass');
    expect((await mentions(target.id)).total).toBe(1);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${source.id}`,
      payload: { rev: source.rev, body: 'pockets are empty now' },
    });
    expect((await mentions(target.id)).total).toBe(0);
  });

  it('recomputes incoming mentions when a note is created or renamed (F222)', async () => {
    const source = await createNote('Old Tale', 'the Glass Mountain rises east');
    // Title appears in prose before the note exists — creating it indexes the mention.
    const target = await createNote('Glass Mountain');
    expect((await mentions(target.id)).total).toBe(1);

    // Renaming away clears mentions of the old title…
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${target.id}`,
      payload: { rev: 0, title: 'Crystal Mountain' },
    });
    expect(renamed.statusCode).toBe(200);
    expect((await mentions(target.id)).total).toBe(0);

    // …and renaming onto text that exists picks it up again.
    const again = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${target.id}`,
      payload: { rev: renamed.json().data.rev, title: 'Glass Mountain' },
    });
    expect(again.statusCode).toBe(200);
    expect((await mentions(target.id)).total).toBe(1);
    expect((await mentions(target.id)).sources[0]!.note.id).toBe(source.id);
  });

  it('404s for unknown notes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notes/nope/mentions' });
    expect(res.statusCode).toBe(404);
  });
});

describe('mention → wikilink conversion (F224, F225)', () => {
  it('converts a single mention, preserving original casing as an alias', async () => {
    const target = await createNote('Iron Gate');
    const source = await createNote('Walk', 'passed the iron gate twice; the iron gate creaked');

    const before = await mentions(target.id);
    expect(before.total).toBe(2);
    const first = before.sources[0]!.links[0]!;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/notes/${target.id}/mentions/link`,
      payload: { mentionId: first.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ converted: 1, sources: 1 });

    const updated = await getNote(source.id);
    expect(updated.body).toBe('passed the [[Iron Gate|iron gate]] twice; the iron gate creaked');
    expect(updated.rev).toBe(source.rev + 1);

    // The remaining mention survived with a fresh position.
    const after = await mentions(target.id);
    expect(after.total).toBe(1);
    expect(updated.body.slice(after.sources[0]!.links[0]!.position)).toMatch(/^iron gate creaked/);
  });

  it('converts all mentions across sources in one call', async () => {
    const target = await createNote('Salt Road');
    const a = await createNote('Trade Notes', 'the Salt Road runs north of the salt road fork');
    const b = await createNote('Map Margins', 'Salt Road again');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/notes/${target.id}/mentions/link`,
      payload: { all: true },
    });
    expect(res.json().data).toEqual({ converted: 3, sources: 2 });

    expect((await getNote(a.id)).body).toBe(
      'the [[Salt Road]] runs north of the [[Salt Road|salt road]] fork',
    );
    expect((await getNote(b.id)).body).toBe('[[Salt Road]] again');
    expect((await mentions(target.id)).total).toBe(0);

    // Converted mentions are now real backlinks.
    const backlinks = await app.inject({
      method: 'GET',
      url: `/api/v1/notes/${target.id}/backlinks`,
    });
    expect(backlinks.json().data.total).toBe(3);
  });

  it('validates its inputs', async () => {
    const target = await createNote('Lone Note');
    const neither = await app.inject({
      method: 'POST',
      url: `/api/v1/notes/${target.id}/mentions/link`,
      payload: {},
    });
    expect(neither.statusCode).toBe(422);
    const both = await app.inject({
      method: 'POST',
      url: `/api/v1/notes/${target.id}/mentions/link`,
      payload: { mentionId: 'link_x', all: true },
    });
    expect(both.statusCode).toBe(422);
    const missing = await app.inject({
      method: 'POST',
      url: `/api/v1/notes/${target.id}/mentions/link`,
      payload: { mentionId: 'link_does_not_exist' },
    });
    expect(missing.statusCode).toBe(404);
  });
});
