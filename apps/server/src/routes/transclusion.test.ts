import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { createNote } from '../services/notes.js';
import { inlineTransclusions } from '../services/transclusion.js';

let app: FastifyInstance;
let notebookId: string;

async function post(url: string, payload?: unknown) {
  return app.inject({ method: 'POST', url: `/api/v1${url}`, payload: (payload ?? {}) as object });
}
async function get(url: string) {
  return app.inject({ method: 'GET', url: `/api/v1${url}` });
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  notebookId = (await post('/notebooks', { name: 'T' })).json().data.id;
});
afterAll(async () => {
  await app.close();
});

describe('block + section transclusion (F671/F672)', () => {
  it('fetches a block by id', async () => {
    const noteId = (
      await post('/notes', {
        notebookId,
        title: 'Blocky',
        body: 'first line\nthe important fact ^fact1\nlast line',
      })
    ).json().data.id;
    const res = await get(`/notes/${noteId}/block/fact1`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.content).toBe('the important fact');
  });

  it('404s on a missing block with structured details', async () => {
    const noteId = (
      await post('/notes', { notebookId, title: 'Empty', body: 'nothing here' })
    ).json().data.id;
    const res = await get(`/notes/${noteId}/block/nope`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.details).toMatchObject({ blockId: 'nope' });
  });

  it('fetches a section by heading up to the next same-level heading', async () => {
    const noteId = (
      await post('/notes', {
        notebookId,
        title: 'Sectioned',
        body: '# Intro\nalpha\n## Sub\nbeta\n# Outro\ngamma',
      })
    ).json().data.id;
    const res = await get(`/notes/${noteId}/section?heading=Intro`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.content).toBe('# Intro\nalpha\n## Sub\nbeta');
    expect(res.json().data.content).not.toContain('Outro');
  });
});

describe('compile-time transclusion inlining (F679)', () => {
  it('inlines ![[note]] with provenance comments', () => {
    const fresh = openDb(':memory:');
    migrate(fresh);
    const nb = notebooksRepo(fresh).create({ name: 'src' });
    createNote(fresh, { notebookId: nb.id, title: 'Lore', body: 'the ancient pact endures' });

    const result = inlineTransclusions(fresh, `Intro\n![[Lore]]\nOutro`);
    expect(result.source).toContain('// <<< transcluded from [[Lore]]');
    expect(result.source).toContain('the ancient pact endures');
    expect(result.source).toContain('// >>> end transclusion');
    expect(result.resolved).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('collects errors for stale references and leaves the line untouched', () => {
    const fresh = openDb(':memory:');
    migrate(fresh);
    const result = inlineTransclusions(fresh, `![[Ghost Note]]`);
    expect(result.errors).toEqual([{ ref: 'Ghost Note', reason: 'missing-note' }]);
    expect(result.source).toContain('![[Ghost Note]]');
  });
});
