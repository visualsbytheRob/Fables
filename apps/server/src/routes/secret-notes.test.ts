/**
 * Secret-notes route tests (Epic 13, F1241–F1249, F1213).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';

let app: FastifyInstance;
let notebookId: string;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  notebookId = notebooksRepo(app.db).create({ name: 'Private' }).id;
});

afterAll(async () => {
  await app.close();
});

describe('secret-notes routes (F1241–F1245/F1213)', () => {
  it('creates the secret box, marks a note, searches it, then reveals it', async () => {
    const note = notesRepo(app.db).create({
      notebookId: notebookId as never,
      title: 'Vault combo',
      body: 'left 12 right 7 left 21',
    });

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/secret',
      payload: { passphrase: 'open-sesame', strength: 'interactive' },
    });
    expect((create.json() as { data: { status: string } }).data.status).toBe('unlocked');

    const mark = await app.inject({ method: 'POST', url: `/api/v1/notes/${note.id}/secret` });
    expect(mark.statusCode).toBe(200);

    // Encrypted FTS finds it while unlocked (F1213).
    const search = await app.inject({ method: 'GET', url: '/api/v1/secret/search?q=combo' });
    const hits = (search.json() as { data: { hits: { id: string }[] } }).data.hits;
    expect(hits.some((h) => h.id === note.id)).toBe(true);

    // Reveal decrypts.
    const reveal = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}/secret` });
    expect((reveal.json() as { data: { title: string } }).data.title).toBe('Vault combo');

    // Lock → search is empty.
    await app.inject({ method: 'POST', url: '/api/v1/secret/lock' });
    const locked = await app.inject({ method: 'GET', url: '/api/v1/secret/search?q=combo' });
    expect((locked.json() as { data: { hits: unknown[] } }).data.hits).toEqual([]);
  });

  it('reveal is forbidden while locked', async () => {
    const note = notesRepo(app.db).create({
      notebookId: notebookId as never,
      title: 'Another secret',
      body: 'shh',
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/secret/unlock',
      payload: { passphrase: 'open-sesame' },
    });
    await app.inject({ method: 'POST', url: `/api/v1/notes/${note.id}/secret` });
    await app.inject({ method: 'POST', url: '/api/v1/secret/lock' });
    const res = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}/secret` });
    expect(res.statusCode).toBe(403);
  });
});
