/**
 * Bulk-operations route tests (Epic 20, F1951–F1958).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { tagsRepo } from '../db/repos/tags.js';

let app: FastifyInstance;
let notebookId: string;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  notebookId = notebooksRepo(app.db).create({ name: `nb-${crypto.randomUUID()}` }).id;
});

function makeNote(title: string, body: string): string {
  return notesRepo(app.db).create({ notebookId: notebookId as never, title, body }).id;
}

describe('preview → apply → undo (F1951/F1958)', () => {
  it('previews a find-and-replace without changing notes, then applies it', async () => {
    const id = makeNote('Draft', 'the colour is grey');

    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/bulk/preview',
      payload: {
        op: { type: 'findAndReplace', options: { find: 'colour', replace: 'color' } },
        scope: { noteIds: [id] },
      },
    });
    expect((preview.json() as { data: { totalAffected: number } }).data.totalAffected).toBe(1);
    // Note unchanged by preview.
    expect(notesRepo(app.db).get(id as never)?.body).toContain('colour');

    const apply = await app.inject({
      method: 'POST',
      url: '/api/v1/bulk/apply',
      payload: {
        op: { type: 'findAndReplace', options: { find: 'colour', replace: 'color' } },
        scope: { noteIds: [id] },
      },
    });
    const journalId = (apply.json() as { data: { journalId: string } }).data.journalId;
    expect(notesRepo(app.db).get(id as never)?.body).toBe('the color is grey');

    const undo = await app.inject({ method: 'POST', url: `/api/v1/bulk/${journalId}/undo` });
    expect(undo.statusCode).toBe(200);
    expect(notesRepo(app.db).get(id as never)?.body).toBe('the colour is grey');

    // A second undo is rejected.
    const again = await app.inject({ method: 'POST', url: `/api/v1/bulk/${journalId}/undo` });
    expect(again.statusCode).toBe(422);
  });

  it('applies a bulk tag add across a scope and undoes it', async () => {
    const a = makeNote('A', 'x');
    const b = makeNote('B', 'y');

    const apply = await app.inject({
      method: 'POST',
      url: '/api/v1/bulk/apply',
      payload: {
        op: { type: 'tagOp', op: { action: 'add', tag: 'reviewed' } },
        scope: { noteIds: [a, b] },
      },
    });
    const journalId = (apply.json() as { data: { journalId: string } }).data.journalId;
    expect(
      tagsRepo(app.db)
        .tagsForNote(a as never)
        .map((t) => t.name),
    ).toContain('reviewed');

    await app.inject({ method: 'POST', url: `/api/v1/bulk/${journalId}/undo` });
    expect(
      tagsRepo(app.db)
        .tagsForNote(a as never)
        .map((t) => t.name),
    ).not.toContain('reviewed');
  });

  it('merges notes and the merge is reversible', async () => {
    const target = makeNote('Target', 'head');
    const source = makeNote('Source', 'tail');

    const apply = await app.inject({
      method: 'POST',
      url: '/api/v1/bulk/apply',
      payload: {
        op: { type: 'merge', targetId: target, sourceIds: [source] },
        scope: { noteIds: [target, source] },
      },
    });
    const data = (apply.json() as { data: { journalId: string; removedIds: string[] } }).data;
    expect(data.removedIds).toContain(source);
    expect(notesRepo(app.db).get(target as never)?.body).toContain('tail');
    // The source note was trashed.
    expect(notesRepo(app.db).get(source as never)?.trashedAt).not.toBeNull();

    const undo = await app.inject({ method: 'POST', url: `/api/v1/bulk/${data.journalId}/undo` });
    expect(undo.statusCode).toBe(200);
    // Target body restored to just its own content.
    expect(notesRepo(app.db).get(target as never)?.body).toBe('head');
  });

  it('records each operation in the journal history', async () => {
    const id = makeNote('J', 'hello');
    await app.inject({
      method: 'POST',
      url: '/api/v1/bulk/apply',
      payload: {
        op: { type: 'findAndReplace', options: { find: 'hello', replace: 'hi' } },
        scope: { noteIds: [id] },
      },
    });
    const history = await app.inject({ method: 'GET', url: '/api/v1/bulk/history' });
    expect(
      (history.json() as { data: { entries: unknown[] } }).data.entries.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('rejects an invalid regex find-and-replace', async () => {
    const id = makeNote('R', 'abc');
    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/bulk/preview',
      payload: {
        op: { type: 'findAndReplace', options: { find: '(', replace: 'x', mode: 'regex' } },
        scope: { noteIds: [id] },
      },
    });
    // The engine reports the error in the plan summary rather than throwing.
    expect((preview.json() as { data: { summary: string } }).data.summary).toMatch(/error/i);
  });
});
