/**
 * Audio accessibility route tests (Epic 17, F1682/F1684).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { storiesRepo } from '../db/repos/stories.js';
import type { StoryId } from '@fables/core';

const SOURCE = `=== intro ===
The hall was silent.
"Who goes there?" asked Mira.
+ [Open the door] -> done
+ [Turn back] -> done

=== done ===
-> END
`;

let app: FastifyInstance;
let storyId: StoryId;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const stories = storiesRepo(app.db);
  storyId = stories.create({ title: 'Accessible Fable' }).id;
  stories.createFile(storyId, 'main.fable', SOURCE);
});

afterAll(async () => {
  await app.close();
});

describe('POST /stories/:id/transcript (F1684)', () => {
  it('returns a speaker-attributed transcript and spoken choice menus', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/transcript`,
      payload: { path: ['intro'] },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as { data: { format: string; transcript: string; choiceMenus: string[] } }
    ).data;
    expect(data.format).toBe('text');
    expect(data.transcript).toContain('Narrator: The hall was silent.');
    expect(data.choiceMenus.length).toBeGreaterThan(0);
    expect(data.choiceMenus[0]).toContain('Option 1');
  });

  it('returns WebVTT captions when asked', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/transcript`,
      payload: { path: ['intro'], format: 'vtt' },
    });
    expect(res.statusCode).toBe(200);
    const transcript = (res.json() as { data: { transcript: string } }).data.transcript;
    expect(transcript.startsWith('WEBVTT')).toBe(true);
    expect(transcript).toContain('-->');
  });

  it('404s for an unknown story', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stories/story_nope/transcript',
      payload: { path: ['intro'] },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('audio a11y settings via /soundscape/mix (F1686/F1687)', () => {
  it('round-trips mono/balance/normalizeVoices', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/soundscape/mix',
      payload: { mono: true, balance: -0.5, normalizeVoices: false },
    });
    expect(put.statusCode).toBe(200);
    const data = (
      put.json() as { data: { mono: boolean; balance: number; normalizeVoices: boolean } }
    ).data;
    expect(data.mono).toBe(true);
    expect(data.balance).toBe(-0.5);
    expect(data.normalizeVoices).toBe(false);
  });
});
