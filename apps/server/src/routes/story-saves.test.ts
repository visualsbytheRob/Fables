import { createStoryFromSource, type StorySaveState } from '@fables/forge-vm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let storyId: string;

// Sticky (+) choices so scripted replays can loop any number of turns.
const SOURCE = `-> crossroads

=== crossroads ===
The path splits.
+ Take the left fork.
  You went left.
  -> crossroads
+ Take the right fork.
  You went right.
  -> END
`;

/** A genuine forge-vm save state, `turns` choices deep. */
function vmState(turns: number): StorySaveState {
  const story = createStoryFromSource(SOURCE, { seed: 11 });
  story.continue();
  for (let i = 0; i < turns; i++) {
    story.choose(0);
    story.continue();
  }
  return story.saveState();
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/stories',
    payload: { title: 'Saveable' },
  });
  storyId = created.json().data.id;
});

afterAll(async () => {
  await app.close();
});

describe('save slots (F462)', () => {
  it('creates, overwrites, fetches, and deletes named slots', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/saves`,
      payload: { name: 'before the fork', state: vmState(1) },
    });
    expect(created.statusCode).toBe(201);
    const slot = created.json().data;
    expect(slot).toMatchObject({
      kind: 'slot',
      name: 'before the fork',
      turn: 1,
      scene: 'crossroads',
    });
    expect(slot.id).toMatch(/^sav_/);
    expect(slot.state).toBeUndefined(); // metadata envelope, state via GET one

    const overwritten = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/saves`,
      payload: { name: 'before the fork', state: vmState(3) },
    });
    expect(overwritten.statusCode).toBe(200); // same slot, new state
    expect(overwritten.json().data.id).toBe(slot.id);
    expect(overwritten.json().data.turn).toBe(3);

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/saves/${slot.id}`,
    });
    const state = fetched.json().data.state;
    expect(state.turn).toBe(3);
    expect(state.history).toHaveLength(3);
    expect(typeof state.bytecode).toBe('string');

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/stories/${storyId}/saves/${slot.id}`,
    });
    expect(deleted.json().data).toEqual({ id: slot.id, deleted: true });
    const gone = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/saves/${slot.id}`,
    });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects structurally invalid states (F469 at the API boundary)', async () => {
    for (const state of [null, 42, {}, { ...vmState(0), status: 'weird' }]) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/stories/${storyId}/saves`,
        payload: { name: 'corrupt', state },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.message).toContain('invalid save state');
    }
  });

  it('404s for unknown stories and saves', async () => {
    const noStory = await app.inject({
      method: 'POST',
      url: '/api/v1/stories/story_nope/saves',
      payload: { name: 'x', state: vmState(0) },
    });
    expect(noStory.statusCode).toBe(404);
    const noSave = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/saves/sav_nope`,
    });
    expect(noSave.statusCode).toBe(404);
  });
});

describe('autosave ring buffer (F463)', () => {
  it('keeps only the newest 10 autosaves', async () => {
    for (let i = 0; i <= 12; i++) {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/stories/${storyId}/autosave`,
        payload: { state: vmState(Math.min(i, 4)) },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.retained).toBe(Math.min(i + 1, 10));
      expect(res.json().data.save.kind).toBe('auto');
    }

    const autos = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/saves?kind=auto`,
    });
    expect(autos.json().data).toHaveLength(10);
    // Newest first, and the oldest three rolled off the ring.
    expect(autos.json().data[0].turn).toBe(4);
  });

  it('lists slots and autosaves separately', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/saves`,
      payload: { name: 'milestone', state: vmState(2) },
    });
    const slots = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/saves?kind=slot`,
    });
    expect(slots.json().data.every((s: { kind: string }) => s.kind === 'slot')).toBe(true);
    const all = await app.inject({ method: 'GET', url: `/api/v1/stories/${storyId}/saves` });
    expect(all.json().data.length).toBeGreaterThan(10);
  });
});
