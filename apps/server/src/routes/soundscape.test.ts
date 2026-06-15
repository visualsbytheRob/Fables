/**
 * Soundscape route tests (Epic 17, F1632/F1634/F1637/F1638).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { storiesRepo } from '../db/repos/stories.js';
import type { StoryId } from '@fables/core';

const SOURCE = `=== storm_scene ===
# scene: storm
Rain lashed the deck.
~ play("door")
-> END
`;

let app: FastifyInstance;
let storyId: StoryId;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const stories = storiesRepo(app.db);
  const story = stories.create({ title: 'Tempest' });
  storyId = story.id;
  stories.createFile(storyId, 'main.fable', SOURCE);
});

afterAll(async () => {
  await app.close();
});

describe('GET /soundscape/library + /attribution (F1634)', () => {
  it('returns CC0 sounds and an attribution manifest', async () => {
    const lib = await app.inject({ method: 'GET', url: '/api/v1/soundscape/library' });
    expect(lib.statusCode).toBe(200);
    const sounds = (lib.json() as { data: { sounds: { license: string }[] } }).data.sounds;
    expect(sounds.length).toBeGreaterThan(0);
    expect(sounds.every((s) => s.license === 'CC0')).toBe(true);

    const att = await app.inject({ method: 'GET', url: '/api/v1/soundscape/attribution' });
    expect((att.json() as { data: { attribution: unknown[] } }).data.attribution.length).toBe(
      sounds.length,
    );
  });
});

describe('Audio mix (F1638)', () => {
  it('round-trips clamped mix levels', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/soundscape/mix',
      payload: { mix: { ambient: 0.3 }, duckAmount: 0.5 },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/v1/soundscape/mix' });
    const data = (get.json() as { data: { mix: { ambient: number }; duckAmount: number } }).data;
    expect(data.mix.ambient).toBe(0.3);
    expect(data.duckAmount).toBe(0.5);
  });
});

describe('POST /stories/:id/soundscape (F1632/F1637)', () => {
  it('extracts scene bindings + sound triggers from the story source', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/soundscape`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as {
        data: {
          bindings: { knot: string; soundscape: string; sound: string | null }[];
          triggers: { sound: string; known: boolean }[];
        };
      }
    ).data;
    expect(data.bindings.some((b) => b.soundscape === 'storm' && b.sound === 'storm')).toBe(true);
    expect(data.triggers.some((t) => t.sound === 'door' && t.known)).toBe(true);
  });

  it('404s for an unknown story', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stories/story_nope/soundscape',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
