/**
 * Audiobook export route tests (Epic 17, F1661/F1662/F1666).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { storiesRepo } from '../db/repos/stories.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import type { StoryId } from '@fables/core';

const SOURCE = `=== intro ===
The tale begins.
-> chapter_two

=== chapter_two ===
And it continues.
-> END
`;

let app: FastifyInstance;
let storyId: StoryId;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const stories = storiesRepo(app.db);
  storyId = stories.create({ title: 'Grand Fable' }).id;
  stories.createFile(storyId, 'main.fable', SOURCE);
});

afterAll(async () => {
  await app.close();
});

describe('POST /stories/:id/audiobook (F1661/F1662)', () => {
  it('returns chapters from knot titles, a size estimate, and a cue sheet', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/audiobook`,
      payload: { path: ['intro', 'chapter_two'], format: 'm4b' },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as {
        data: {
          manifest: { chapters: { title: string }[]; estimatedBytes: number; totalMs: number };
          cue: string;
        };
      }
    ).data;
    expect(data.manifest.chapters.map((c) => c.title)).toEqual(['Intro', 'Chapter Two']);
    expect(data.manifest.estimatedBytes).toBeGreaterThan(0);
    expect(data.cue).toContain('TRACK 01 AUDIO');
  });

  it('404s for an unknown story', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stories/story_nope/audiobook',
      payload: { path: ['intro'] },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /notebooks/:id/audiobook (F1666)', () => {
  it('builds one chapter per note', async () => {
    const nb = notebooksRepo(app.db).create({ name: 'Journal' });
    notesRepo(app.db).create({ notebookId: nb.id, title: 'Day One', body: 'It rained all day.' });
    notesRepo(app.db).create({ notebookId: nb.id, title: 'Day Two', body: 'The sun returned.' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/notebooks/${nb.id}/audiobook`,
      payload: { format: 'opus' },
    });
    expect(res.statusCode).toBe(200);
    const manifest = (
      res.json() as { data: { manifest: { chapters: { title: string }[]; totalMs: number } } }
    ).data.manifest;
    expect(manifest.chapters.length).toBe(2);
    expect(manifest.totalMs).toBeGreaterThan(0);
  });

  it('404s for an unknown notebook', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notebooks/nb_nope/audiobook',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
