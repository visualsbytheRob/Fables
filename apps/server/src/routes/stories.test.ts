import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;

const BROKEN_SOURCE = 'A dead end.\n-> nowhere\n';

async function createStory(payload: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/stories',
    payload: { title: 'The Fox Road', ...payload },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

describe('story CRUD (F501)', () => {
  it('creates a story with defaults, settings, and a starter entry file', async () => {
    const story = await createStory({
      description: 'A tale of roads.',
      settings: { cover: { color: '#aa3322', emoji: '🦊' }, theme: 'sepia' },
    });
    expect(story.id).toMatch(/^story_/);
    expect(story).toMatchObject({
      title: 'The Fox Road',
      description: 'A tale of roads.',
      entryFile: 'main.fable',
      status: 'draft',
      isTemplate: false,
      errorCount: 0,
      warningCount: 0,
      builtAt: null,
      settings: {
        cover: { color: '#aa3322', emoji: '🦊' },
        theme: 'sepia',
        seedMode: 'random',
      },
    });

    const files = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}/files` });
    expect(files.json().data).toHaveLength(1);
    expect(files.json().data[0].path).toBe('main.fable');
  });

  it('fetches and 404s', async () => {
    const story = await createStory();
    const got = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}` });
    expect(got.json().data).toEqual(story);
    const missing = await app.inject({ method: 'GET', url: '/api/v1/stories/story_nope' });
    expect(missing.statusCode).toBe(404);
  });

  it('lists with cursor pagination', async () => {
    await createStory({ title: 'P1' });
    await createStory({ title: 'P2' });
    const first = await app.inject({ method: 'GET', url: '/api/v1/stories?limit=1' });
    expect(first.json().data).toHaveLength(1);
    const cursor = first.json().page.nextCursor;
    expect(cursor).toBeTruthy();
    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/stories?limit=200&cursor=${cursor}`,
    });
    expect(second.json().data.some((s: { id: string }) => s.id === cursor)).toBe(false);
  });

  it('rejects invalid entry file paths', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stories',
      payload: { title: 'Bad', entryFile: '../escape.fable' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});

describe('story settings (F507)', () => {
  it('merges settings patches field by field', async () => {
    const story = await createStory({ settings: { cover: { emoji: '🌲' } } });
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${story.id}`,
      payload: { settings: { seedMode: 'fixed', seed: 42, cover: { color: '#001122' } } },
    });
    expect(patched.json().data.settings).toEqual({
      cover: { color: '#001122', emoji: '🌲' },
      theme: null,
      seedMode: 'fixed',
      seed: 42,
    });
  });

  it('validates the entry file exists before switching to it', async () => {
    const story = await createStory();
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${story.id}`,
      payload: { entryFile: 'ghost.fable' },
    });
    expect(bad.statusCode).toBe(422);

    await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${story.id}/files`,
      payload: { path: 'alt.fable', source: 'Another beginning.\n-> END\n' },
    });
    const good = await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${story.id}`,
      payload: { entryFile: 'alt.fable' },
    });
    expect(good.json().data.entryFile).toBe('alt.fable');
    // Switching entry points recompiles (F504).
    expect(good.json().data.status).toBe('valid');
  });
});

describe('build status (F504/F505)', () => {
  it('starts draft, compiles to valid, breaks with diagnostics', async () => {
    const story = await createStory();
    const draft = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}/build` });
    expect(draft.json().data).toMatchObject({ status: 'draft', errorCount: 0, builtAt: null });

    const built = await app.inject({ method: 'POST', url: `/api/v1/stories/${story.id}/build` });
    expect(built.json().data).toMatchObject({ status: 'valid', errorCount: 0 });
    expect(built.json().data.builtAt).toBeTruthy();

    const files = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}/files` });
    const entryId = files.json().data[0].id;
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${story.id}/files/${entryId}`,
      payload: { source: BROKEN_SOURCE },
    });

    const broken = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}/build` });
    expect(broken.json().data.status).toBe('broken');
    expect(broken.json().data.errorCount).toBeGreaterThan(0);
    const diag = broken.json().data.diagnostics[0];
    expect(diag).toMatchObject({ severity: 'error', file: 'main.fable' });
    expect(diag.span.start.line).toBeGreaterThan(0);

    const listed = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}` });
    expect(listed.json().data.status).toBe('broken');
  });
});

describe('releases (F506)', () => {
  it('compiles and snapshots sources under a unique name', async () => {
    const story = await createStory({ title: 'Released' });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${story.id}/releases`,
      payload: { name: 'v1.0' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ name: 'v1.0', status: 'valid', fileCount: 1 });
    expect(created.json().data.id).toMatch(/^rel_/);

    const dup = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${story.id}/releases`,
      payload: { name: 'v1.0' },
    });
    expect(dup.statusCode).toBe(409);

    const list = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}/releases` });
    expect(list.json().data).toHaveLength(1);

    const one = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${story.id}/releases/${created.json().data.id}`,
    });
    expect(one.json().data.files['main.fable']).toContain('-> END');
  });

  it('refuses to release a broken story', async () => {
    const story = await createStory({ title: 'Cracked' });
    const files = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}/files` });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${story.id}/files/${files.json().data[0].id}`,
      payload: { source: BROKEN_SOURCE },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${story.id}/releases`,
      payload: { name: 'v0' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.errorCount).toBeGreaterThan(0);
  });
});

describe('duplication + templates (F508)', () => {
  it('copies files and settings under fresh ids', async () => {
    const story = await createStory({
      title: 'Original',
      settings: { cover: { emoji: '🏰' }, seedMode: 'fixed', seed: 9 },
    });
    await app.inject({ method: 'POST', url: `/api/v1/stories/${story.id}/build` });

    const copyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${story.id}/duplicate`,
      payload: {},
    });
    expect(copyRes.statusCode).toBe(201);
    const copy = copyRes.json().data;
    expect(copy.id).not.toBe(story.id);
    expect(copy.title).toBe('Original (copy)');
    expect(copy.settings.cover.emoji).toBe('🏰');
    expect(copy.settings.seed).toBe(9);
    expect(copy.status).toBe('valid'); // built original ⇒ built copy

    const copyFiles = await app.inject({ method: 'GET', url: `/api/v1/stories/${copy.id}/files` });
    expect(copyFiles.json().data.map((f: { path: string }) => f.path)).toEqual(['main.fable']);
  });

  it('instantiates template stories as regular stories', async () => {
    const template = await createStory({ title: 'Mystery Template', isTemplate: true });
    const list = await app.inject({ method: 'GET', url: '/api/v1/stories?template=true' });
    expect(list.json().data.some((s: { id: string }) => s.id === template.id)).toBe(true);

    const inst = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${template.id}/duplicate`,
      payload: { title: 'My Mystery' },
    });
    expect(inst.json().data).toMatchObject({ title: 'My Mystery', isTemplate: false });
  });
});

describe('deletion with confirm (F509)', () => {
  it('requires the exact title and reports what went with it', async () => {
    const story = await createStory({ title: 'Doomed' });

    const noConfirm = await app.inject({ method: 'DELETE', url: `/api/v1/stories/${story.id}` });
    expect(noConfirm.statusCode).toBe(422);
    expect(noConfirm.json().error.details.saveCount).toBe(0);

    const wrong = await app.inject({
      method: 'DELETE',
      url: `/api/v1/stories/${story.id}?confirm=doomed`,
    });
    expect(wrong.statusCode).toBe(422);

    const right = await app.inject({
      method: 'DELETE',
      url: `/api/v1/stories/${story.id}?confirm=${encodeURIComponent('Doomed')}`,
    });
    expect(right.statusCode).toBe(200);
    expect(right.json().data).toMatchObject({ deleted: true, deletedFiles: 1 });

    const gone = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}` });
    expect(gone.statusCode).toBe(404);
  });
});
