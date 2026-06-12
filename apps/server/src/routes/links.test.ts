import type { NoteId } from '@fables/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { linksRepo } from '../db/repos/links.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { createNote } from '../services/notes.js';

let app: FastifyInstance;
let notebookId: string;

interface NoteJson {
  id: string;
  rev: number;
  title: string;
  body: string;
}

async function createNoteHttp(title: string, body = ''): Promise<NoteJson> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notes',
    payload: { notebookId, title, body },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

async function getNote(id: string): Promise<NoteJson> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/notes/${id}` });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

interface BacklinksJson {
  noteId: string;
  total: number;
  sources: {
    note: { id: string; title: string; notebookId: string; updatedAt: string };
    count: number;
    links: {
      id: string;
      position: number;
      length: number;
      text: string;
      heading: string | null;
      blockId: string | null;
      snippet: { text: string; highlightStart: number; highlightEnd: number };
    }[];
  }[];
}

async function backlinks(id: string): Promise<BacklinksJson> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/notes/${id}/backlinks` });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notebooks',
    payload: { name: 'LinkLab' },
  });
  notebookId = res.json().data.id;
});

afterAll(async () => {
  await app.close();
});

describe('link table maintenance on save (F202)', () => {
  it('indexes resolved wikilinks with positions on create and update', async () => {
    const target = await createNoteHttp('Harbor Town');
    const source = await createNoteHttp('Travel Log', 'left [[Harbor Town]] at dawn');

    let incoming = await backlinks(target.id);
    expect(incoming.total).toBe(1);
    expect(incoming.sources[0]!.note.id).toBe(source.id);
    expect(incoming.sources[0]!.links[0]!.position).toBe(5);
    expect(incoming.sources[0]!.links[0]!.text).toBe('[[Harbor Town]]');

    // Removing the link on update clears the row.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${source.id}`,
      payload: { rev: source.rev, body: 'no links anymore' },
    });
    incoming = await backlinks(target.id);
    expect(incoming.total).toBe(0);
  });

  it('resolves titles case-insensitively', async () => {
    const target = await createNoteHttp('The Lighthouse');
    await createNoteHttp('Sailor Note', 'about [[the lighthouse]]');
    expect((await backlinks(target.id)).total).toBe(1);
  });

  it('keeps unresolved targets as broken rows that heal when the note appears (F206)', async () => {
    const source = await createNoteHttp('Wish List', 'I want [[Future Note Xyz]] someday');
    const rows = linksRepo(app.db).listBySource(source.id as NoteId, 'wikilink');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.broken).toBe(true);
    expect(rows[0]!.targetId).toBe('');
    expect(rows[0]!.targetTitle).toBe('future note xyz');

    const target = await createNoteHttp('Future Note Xyz');
    const healed = linksRepo(app.db).listBySource(source.id as NoteId, 'wikilink');
    expect(healed[0]!.broken).toBe(false);
    expect(healed[0]!.targetId).toBe(target.id);
    expect((await backlinks(target.id)).total).toBe(1);
  });
});

describe('backlinks endpoint (F211, F213, F216, F217, F220)', () => {
  it('groups by source with counts, snippets, and heading/block anchors', async () => {
    const target = await createNoteHttp('Engine Room');
    const busy = await createNoteHttp(
      'Maintenance',
      'check [[Engine Room]] then recheck [[Engine Room#Coolant]] and [[Engine Room^blk42]]',
    );
    await new Promise((r) => setTimeout(r, 5)); // distinct updated_at for the recency sort
    const quiet = await createNoteHttp('Tour', 'walked past the [[Engine Room]] briefly');

    const data = await backlinks(target.id);
    expect(data.total).toBe(4);
    expect(data.sources).toHaveLength(2);
    // Recency sort: `quiet` was updated last.
    expect(data.sources[0]!.note.id).toBe(quiet.id);
    const busyGroup = data.sources.find((s) => s.note.id === busy.id)!;
    expect(busyGroup.count).toBe(3);
    expect(busyGroup.links.map((l) => l.heading)).toEqual([null, 'Coolant', null]);
    expect(busyGroup.links.map((l) => l.blockId)).toEqual([null, null, 'blk42']);

    const snippet = busyGroup.links[0]!.snippet;
    expect(snippet.text.slice(snippet.highlightStart, snippet.highlightEnd)).toBe(
      '[[Engine Room]]',
    );
  });

  it('trims long context to word boundaries (F220)', async () => {
    const target = await createNoteHttp('Tiny Target');
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    await createNoteHttp('Wall of Text', `${words} [[Tiny Target]] ${words}`);

    const data = await backlinks(target.id);
    const snippet = data.sources[0]!.links[0]!.snippet;
    expect(snippet.text.length).toBeLessThan(200);
    expect(snippet.text.slice(snippet.highlightStart, snippet.highlightEnd)).toBe(
      '[[Tiny Target]]',
    );
    expect(snippet.text.startsWith('word')).toBe(true);
    expect(/word\d+$/.test(snippet.text)).toBe(true);
  });

  it('excludes trashed sources and 404s on unknown notes', async () => {
    const target = await createNoteHttp('Popular');
    const source = await createNoteHttp('Fan Note', 'love [[Popular]]');
    await app.inject({ method: 'DELETE', url: `/api/v1/notes/${source.id}` });
    expect((await backlinks(target.id)).total).toBe(0);

    const missing = await app.inject({ method: 'GET', url: '/api/v1/notes/nope/backlinks' });
    expect(missing.statusCode).toBe(404);
  });
});

describe('title rename propagation (F209)', () => {
  it('rewrites [[old]] → [[new]] in linking notes, bumping their rev', async () => {
    const target = await createNoteHttp('Old Star');
    const source = await createNoteHttp(
      'Chart',
      'plot [[Old Star]] and [[old star#Orbit|the orbit]]',
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${target.id}`,
      payload: { rev: target.rev, title: 'New Star' },
    });
    expect(res.statusCode).toBe(200);

    const rewritten = await getNote(source.id);
    expect(rewritten.body).toBe('plot [[New Star]] and [[New Star#Orbit|the orbit]]');
    expect(rewritten.rev).toBe(source.rev + 1);
    expect((await backlinks(target.id)).total).toBe(2);

    // The rewrite produced a revision snapshot on the source.
    const revs = await app.inject({ method: 'GET', url: `/api/v1/notes/${source.id}/revisions` });
    expect(revs.json().data.length).toBeGreaterThanOrEqual(2);
  });

  it('handles self-links and reports the final rev', async () => {
    const note = await createNoteHttp('Ouroboros', 'links to [[Ouroboros]] itself');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${note.id}`,
      payload: { rev: note.rev, title: 'Ouroboros II' },
    });
    const updated = res.json().data as NoteJson;
    expect(updated.body).toBe('links to [[Ouroboros II]] itself');
    expect((await getNote(note.id)).rev).toBe(updated.rev);
  });
});

describe('block id minting (F208)', () => {
  it('mints a stable id, appends it to the line, and is idempotent', async () => {
    const note = await createNoteHttp('Block Note', 'first line\nimportant fact here\nlast line');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/notes/${note.id}/block-id`,
      payload: { line: 1 },
    });
    expect(res.statusCode).toBe(200);
    const { blockId, created, note: updated } = res.json().data;
    expect(created).toBe(true);
    expect(blockId).toMatch(/^[a-z0-9-]+$/i);
    expect(updated.body.split('\n')[1]).toBe(`important fact here ^${blockId}`);
    expect(updated.rev).toBe(note.rev + 1);

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/notes/${note.id}/block-id`,
      payload: { line: 1 },
    });
    expect(again.json().data.blockId).toBe(blockId);
    expect(again.json().data.created).toBe(false);
  });

  it('rejects blank lines, out-of-range lines, and fenced lines', async () => {
    const note = await createNoteHttp('Strict Note', 'text\n\n```\ncode\n```');
    const blank = await app.inject({
      method: 'POST',
      url: `/api/v1/notes/${note.id}/block-id`,
      payload: { line: 1 },
    });
    expect(blank.statusCode).toBe(422);
    const range = await app.inject({
      method: 'POST',
      url: `/api/v1/notes/${note.id}/block-id`,
      payload: { line: 99 },
    });
    expect(range.statusCode).toBe(422);
    const fenced = await app.inject({
      method: 'POST',
      url: `/api/v1/notes/${note.id}/block-id`,
      payload: { line: 3 },
    });
    expect(fenced.statusCode).toBe(422);
  });
});

describe('link integrity job (F219)', () => {
  it('sweeps orphan sources and re-breaks dangling targets', () => {
    const db = openDb(':memory:');
    migrate(db);
    const notebook = notebooksRepo(db).create({ name: 'Lab' });
    const target = createNote(db, { notebookId: notebook.id, title: 'Target' });
    const source = createNote(db, {
      notebookId: notebook.id,
      title: 'Source',
      body: 'see [[Target]], mention of Target too',
    });

    expect(linksRepo(db).listBySource(source.id, 'wikilink')).toHaveLength(1);
    // Hard-delete both ends behind the index's back.
    db.prepare('DELETE FROM notes WHERE id = ?').run(target.id);
    const result = linksRepo(db).cleanupOrphans();
    expect(result.brokenTargets).toBe(1);
    expect(result.removedMentions).toBe(1);

    const rows = linksRepo(db).listBySource(source.id, 'wikilink');
    expect(rows[0]!.broken).toBe(true);
    expect(rows[0]!.targetTitle).toBe('target'); // kept for future re-resolution

    db.prepare('DELETE FROM notes WHERE id = ?').run(source.id);
    expect(linksRepo(db).cleanupOrphans().removedSources).toBe(1);
    db.close();
  });

  it('runs after emptying the trash', async () => {
    const target = await createNoteHttp('Doomed');
    const source = await createNoteHttp('Survivor', 'misses [[Doomed]]');
    await app.inject({ method: 'DELETE', url: `/api/v1/notes/${target.id}` });
    await app.inject({ method: 'POST', url: '/api/v1/trash/empty' });

    const rows = linksRepo(app.db).listBySource(source.id as NoteId, 'wikilink');
    expect(rows[0]!.broken).toBe(true);
    expect(rows[0]!.targetId).toBe('');
  });
});
