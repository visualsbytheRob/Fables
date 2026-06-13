import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let notebookId: string;

async function post(url: string, payload?: unknown) {
  return app.inject({ method: 'POST', url: `/api/v1${url}`, payload: (payload ?? {}) as object });
}
async function get(url: string) {
  return app.inject({ method: 'GET', url: `/api/v1${url}` });
}
async function del(url: string) {
  return app.inject({ method: 'DELETE', url: `/api/v1${url}` });
}
async function setEntry(id: string, source: string) {
  const files = (await get(`/stories/${id}/files`)).json().data;
  const entry = files.find((f: { path: string }) => f.path === 'main.fable');
  await app.inject({
    method: 'PATCH',
    url: `/api/v1/stories/${id}/files/${entry.id}`,
    payload: { source },
  });
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  notebookId = (await post('/notebooks', { name: 'X' })).json().data.id;
});
afterAll(async () => {
  await app.close();
});

describe('story dependencies + impact (F663/F664)', () => {
  it('reports a story’s reads and writes', async () => {
    const heroId = (await post('/entities', { type: 'character', name: 'Knight' })).json().data.id;
    expect(heroId).toBeDefined();
    await post('/notes', { notebookId, title: 'Codex Entry', body: 'lore' });
    const storyId = (await post('/stories', { title: 'Dep' })).json().data.id;
    await setEntry(
      storyId,
      `# title: Dep\n# writes: Knight\nHi @Knight.health\n[[Codex Entry]]\n-> END\n`,
    );

    const deps = (await get(`/stories/${storyId}/dependencies`)).json().data;
    expect(deps.reads.entities).toContain('knight');
    expect(deps.reads.notes).toContain('codex entry');
    expect(deps.writes.entities).toContain('knight');
  });

  it('reports entity impact and which stories reference it', async () => {
    const id = (await post('/entities', { type: 'character', name: 'Sage' })).json().data.id;
    const storyId = (await post('/stories', { title: 'Uses Sage' })).json().data.id;
    await setEntry(storyId, `# title: Uses Sage\n@Sage is here\n-> END\n`);

    const impact = (await get(`/entities/${id}/impact`)).json().data;
    expect(impact.stories.map((s: { storyId: string }) => s.storyId)).toContain(storyId);
  });
});

describe('incoming refs (F661/F662)', () => {
  it('groups note references by kind', async () => {
    const target = (await post('/notes', { notebookId, title: 'Hub', body: 'center' })).json().data
      .id;
    await post('/notes', { notebookId, title: 'Spoke', body: 'see [[Hub]]' });
    const storyId = (await post('/stories', { title: 'Refs Hub' })).json().data.id;
    await setEntry(storyId, `# title: Refs Hub\n[[Hub]]\n-> END\n`);

    const refs = (await get(`/refs/note/${target}`)).json().data;
    const kinds = refs.groups.map((g: { kind: string }) => g.kind);
    expect(kinds).toContain('wikilink');
    expect(kinds).toContain('binding');
    expect(refs.total).toBeGreaterThanOrEqual(2);
  });
});

describe('delete impact guard (F665)', () => {
  it('409s when a bound entity is deleted without force, then deletes with force', async () => {
    const id = (await post('/entities', { type: 'character', name: 'Doomed' })).json().data.id;
    const storyId = (await post('/stories', { title: 'Binds Doomed' })).json().data.id;
    await setEntry(storyId, `# title: Binds Doomed\n@Doomed\n-> END\n`);

    const blocked = await del(`/entities/${id}`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.details.impact.stories.length).toBeGreaterThan(0);

    const forced = await del(`/entities/${id}?force=true`);
    expect(forced.statusCode).toBe(200);
  });

  it('409s when a bound note is deleted without force', async () => {
    const noteId = (await post('/notes', { notebookId, title: 'Bound Lore', body: 'x' })).json()
      .data.id;
    const storyId = (await post('/stories', { title: 'Binds Note' })).json().data.id;
    await setEntry(storyId, `# title: Binds Note\n[[Bound Lore]]\n-> END\n`);

    const blocked = await del(`/notes/${noteId}`);
    expect(blocked.statusCode).toBe(409);
    const forced = await del(`/notes/${noteId}?force=true`);
    expect(forced.statusCode).toBe(200);
  });
});

describe('rebind (F669)', () => {
  it('rewrites @old → @new in sources and recompiles', async () => {
    const oldId = (await post('/entities', { type: 'character', name: 'Oldname' })).json().data.id;
    await post('/entities', { type: 'character', name: 'Newname' });
    const storyId = (await post('/stories', { title: 'Rebindable' })).json().data.id;
    await setEntry(storyId, `# title: Rebindable\nHi @Oldname there\n-> END\n`);
    await post(`/stories/${storyId}/build`);

    const res = await post(`/entities/${oldId}/rebind`, { to: 'Newname' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.references).toBeGreaterThan(0);

    const files = (await get(`/stories/${storyId}/files`)).json().data;
    const entry = files.find((f: { path: string }) => f.path === 'main.fable');
    const src = (await get(`/stories/${storyId}/files/${entry.id}`)).json().data.source;
    expect(src).toContain('@Newname');
    expect(src).not.toContain('@Oldname');
  });
});

describe('graph presets (F667)', () => {
  it('lists named filter presets', async () => {
    const res = await get('/graph/presets');
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((p: { id: string }) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['wikilinks', 'knowledge-web', 'story-web', 'fusion-view']),
    );
  });
});
