import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;

const MAIN = `INCLUDE chapters/one.fable
The journey begins.
-> crossroads
`;

const CHAPTER = `=== crossroads ===
The path splits.
* Take the left fork.
  You went left.
  -> END
* Take the right fork.
  You went right.
  -> END
`;

/** A story whose main.fable INCLUDEs chapters/one.fable. */
async function projectWithInclude() {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/stories',
    payload: { title: 'Forked Paths' },
  });
  const story = created.json().data;
  const files = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}/files` });
  const entry = files.json().data[0];
  const chapter = await app.inject({
    method: 'POST',
    url: `/api/v1/stories/${story.id}/files`,
    payload: { path: 'chapters/one.fable', source: CHAPTER },
  });
  await app.inject({
    method: 'PATCH',
    url: `/api/v1/stories/${story.id}/files/${entry.id}`,
    payload: { source: MAIN },
  });
  return { story, entryId: entry.id as string, chapterId: chapter.json().data.file.id as string };
}

async function getFile(storyId: string, fileId: string) {
  const res = await app.inject({ method: 'GET', url: `/api/v1/stories/${storyId}/files/${fileId}` });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

describe('file CRUD (F502)', () => {
  it('creates, lists, fetches, and validates paths', async () => {
    const { story } = await projectWithInclude();
    const list = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}/files` });
    const paths = list.json().data.map((f: { path: string }) => f.path);
    expect(paths).toEqual(['chapters/one.fable', 'main.fable']);
    // List is metadata-only; sources come from the single-file fetch.
    expect(list.json().data[0].source).toBeUndefined();
    expect(list.json().data[0].bytes).toBeGreaterThan(0);

    const dup = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${story.id}/files`,
      payload: { path: 'chapters/one.fable' },
    });
    expect(dup.statusCode).toBe(409);

    for (const bad of ['../up.fable', 'no-extension', '/abs.fable', 'a//b.fable']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/stories/${story.id}/files`,
        payload: { path: bad },
      });
      expect(res.statusCode, bad).toBe(422);
    }
  });

  it('compiles on save and returns the build outcome inline (F504)', async () => {
    const { story, chapterId } = await projectWithInclude();
    const good = await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${story.id}/files/${chapterId}`,
      payload: { source: CHAPTER },
    });
    expect(good.json().data.build).toMatchObject({ status: 'valid', errorCount: 0 });

    // A parse error inside the included file: diagnostics carry file + span.
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${story.id}/files/${chapterId}`,
      payload: { source: '=== crossroads ===\n~ temp x = "unterminated\n-> END\n' },
    });
    const build = bad.json().data.build;
    expect(build.status).toBe('broken');
    expect(build.errorCount).toBeGreaterThan(0);
    const diag = build.diagnostics.find(
      (d: { file: string; severity: string }) => d.severity === 'error',
    );
    expect(diag.file).toBe('chapters/one.fable');
    expect(diag.span.start.line).toBe(2);

    // The outcome is persisted on the story, not just echoed (F505).
    const status = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}/build` });
    expect(status.json().data.status).toBe('broken');
  });
});

describe('rename + INCLUDE integrity (F503)', () => {
  it('rewrites INCLUDE references in sibling files', async () => {
    const { story, entryId, chapterId } = await projectWithInclude();
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${story.id}/files/${chapterId}`,
      payload: { path: 'chapters/first-fork.fable' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data.file.path).toBe('chapters/first-fork.fable');
    expect(renamed.json().data.rewrittenFiles).toEqual(['main.fable']);
    expect(renamed.json().data.build.status).toBe('valid');

    const main = await getFile(story.id, entryId);
    expect(main.source).toContain('INCLUDE chapters/first-fork.fable');
    expect(main.source).not.toContain('INCLUDE chapters/one.fable');
  });

  it('rewrites the renamed file\'s own includes when it changes directory', async () => {
    const { story, chapterId } = await projectWithInclude();
    await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${story.id}/files`,
      payload: { path: 'chapters/shared.fable', source: '=== camp ===\nA quiet camp.\n-> END\n' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${story.id}/files/${chapterId}`,
      payload: { source: `INCLUDE shared.fable\n${CHAPTER}` },
    });

    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${story.id}/files/${chapterId}`,
      payload: { path: 'one.fable' },
    });
    expect(moved.json().data.build.status).toBe('valid');
    const file = await getFile(story.id, chapterId);
    expect(file.source).toContain('INCLUDE chapters/shared.fable');
  });

  it('keeps the story entry file pointed at a renamed entry', async () => {
    const { story, entryId } = await projectWithInclude();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${story.id}/files/${entryId}`,
      payload: { path: 'start.fable' },
    });
    const fresh = await app.inject({ method: 'GET', url: `/api/v1/stories/${story.id}` });
    expect(fresh.json().data.entryFile).toBe('start.fable');
    expect(fresh.json().data.status).toBe('valid');
  });

  it('refuses renaming onto an existing path', async () => {
    const { story, chapterId } = await projectWithInclude();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/stories/${story.id}/files/${chapterId}`,
      payload: { path: 'main.fable' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('deletion guarded by includes (F503)', () => {
  it('blocks deleting an INCLUDEd file unless forced', async () => {
    const { story, chapterId } = await projectWithInclude();
    const blocked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/stories/${story.id}/files/${chapterId}`,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.details.includedBy).toEqual(['main.fable']);

    const forced = await app.inject({
      method: 'DELETE',
      url: `/api/v1/stories/${story.id}/files/${chapterId}?force=true`,
    });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().data.deleted).toBe(true);
    // The dangling INCLUDE now breaks the build — visibly, not silently.
    expect(forced.json().data.build.status).toBe('broken');
  });

  it('blocks deleting the entry file unless forced', async () => {
    const { story, entryId } = await projectWithInclude();
    const blocked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/stories/${story.id}/files/${entryId}`,
    });
    expect(blocked.statusCode).toBe(409);
  });

  it('deletes unreferenced files freely', async () => {
    const { story } = await projectWithInclude();
    const extra = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${story.id}/files`,
      payload: { path: 'notes.fable', source: 'Scratchpad.\n-> END\n' },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/stories/${story.id}/files/${extra.json().data.file.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.build.status).toBe('valid');
  });
});
