/**
 * Narration renderer route tests (Epic 17, F1621–F1630).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { storiesRepo } from '../db/repos/stories.js';
import { castingRepo } from '../db/repos/casting.js';
import { MockTtsAdapter } from '../audio/tts/mock-adapter.js';
import type { StoryId } from '@fables/core';

const SOURCE = `=== intro ===
The forest was silent.
"Who goes there?" asked Mira.
+ [Press on] -> deeper

=== deeper ===
She stepped into the dark.
-> END
`;

let app: FastifyInstance;
let storyId: StoryId;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const stories = storiesRepo(app.db);
  const story = stories.create({ title: 'Fable' });
  storyId = story.id;
  stories.createFile(storyId, 'main.fable', SOURCE);
  // Cast the narrator + Mira so lines resolve to voices.
  castingRepo(app.db).castSheets.create({
    storyId,
    sheet: {
      narrator: { voiceId: 'mock-amy' },
      bySpeaker: { mira: { voiceId: 'mock-ben' } },
      defaultCharacter: null,
    },
  });
});

afterAll(async () => {
  await app.close();
});

describe('POST /stories/:id/narration/scene (F1621/F1626)', () => {
  it('builds a voiced scene + timeline from a knot path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/narration/scene`,
      payload: { path: ['intro', 'deeper'] },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as {
        data: {
          scene: { items: { kind: string; voice: unknown }[]; totalEstMs: number };
          timeline: { totalMs: number; entries: unknown[] };
        };
      }
    ).data;
    expect(data.scene.items.length).toBeGreaterThan(0);
    expect(data.scene.items.some((i) => i.kind === 'choice')).toBe(true);
    expect(data.scene.totalEstMs).toBeGreaterThan(0);
    expect(data.timeline.entries.length).toBe(data.scene.items.length);
  });

  it('404s for an unknown story', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stories/story_nope/narration/scene',
      payload: { path: ['intro'] },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /stories/:id/narration/prerender (F1624)', () => {
  it('422s with available:false when no engine is present', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/narration/prerender`,
      payload: { path: ['intro'] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('bakes the path to a single audio file once an engine exists', async () => {
    app.tts.register(new MockTtsAdapter());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/narration/prerender`,
      payload: { path: ['intro', 'deeper'] },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as {
        data: {
          format: string;
          audio: string;
          durationMs: number;
          offsets: unknown[];
          realtimeRatio: number;
        };
      }
    ).data;
    expect(data.format).toBe('wav');
    expect(data.audio.length).toBeGreaterThan(0);
    expect(data.offsets.length).toBeGreaterThan(0);
  });
});
