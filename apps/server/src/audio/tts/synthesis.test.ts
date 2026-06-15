/**
 * Synthesis pipeline tests (F1603 caching, F1607 priority queue, F1610).
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { TtsRuntime } from './runtime.js';
import { MockTtsAdapter } from './mock-adapter.js';
import { SynthesisCache, SynthesisQueue, synthHash, synthesizeCached } from './synthesis.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

describe('synthHash', () => {
  it('is stable and sensitive to text + voice + prosody', () => {
    const base = { text: 'hello', voiceId: 'a', rate: 1, pitch: 1 };
    expect(synthHash(base)).toBe(synthHash({ ...base }));
    expect(synthHash(base)).not.toBe(synthHash({ ...base, text: 'world' }));
    expect(synthHash(base)).not.toBe(synthHash({ ...base, voiceId: 'b' }));
    expect(synthHash(base)).not.toBe(synthHash({ ...base, rate: 2 }));
  });
});

describe('SynthesisCache (F1603)', () => {
  it('round-trips audio and reports size', () => {
    const db = freshDb();
    const cache = new SynthesisCache(db);
    expect(cache.get('missing')).toBeNull();

    cache.put('h1', {
      audio: new Uint8Array([1, 2, 3, 4]),
      format: 'wav',
      sampleRate: 22_050,
      voiceId: 'mock-amy',
      durationMs: 120,
    });
    const hit = cache.get('h1');
    expect(hit).not.toBeNull();
    expect(Array.from(hit!.audio)).toEqual([1, 2, 3, 4]);
    expect(hit!.voiceId).toBe('mock-amy');
    expect(hit!.durationMs).toBe(120);
    expect(cache.totalBytes()).toBe(4);
  });

  it('evicts least-recently-used entries to fit a budget', () => {
    const db = freshDb();
    const cache = new SynthesisCache(db);
    const blob = (n: number) => new Uint8Array(n);
    cache.put('old', { audio: blob(100), format: 'wav', sampleRate: 1, voiceId: 'v' });
    cache.put('new', { audio: blob(100), format: 'wav', sampleRate: 1, voiceId: 'v' });
    // Touch "new" so "old" is the eviction victim.
    cache.get('new');
    const removed = cache.evictToFit(100);
    expect(removed).toBe(100);
    expect(cache.get('old')).toBeNull();
    expect(cache.get('new')).not.toBeNull();
  });
});

describe('SynthesisQueue (F1607)', () => {
  it('runs higher priority tasks first, FIFO within a priority', async () => {
    const queue = new SynthesisQueue();
    const order: string[] = [];
    // Block the queue with an in-flight task so the rest sort before draining.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = queue.enqueue(async () => {
      await gate;
      order.push('first');
    }, 0);

    const low = queue.enqueue(async () => void order.push('low'), 0);
    const highA = queue.enqueue(async () => void order.push('highA'), 10);
    const highB = queue.enqueue(async () => void order.push('highB'), 10);

    release();
    await Promise.all([first, low, highA, highB]);
    expect(order).toEqual(['first', 'highA', 'highB', 'low']);
  });

  it('rejects propagate without wedging the queue', async () => {
    const queue = new SynthesisQueue();
    await expect(
      queue.enqueue(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(queue.enqueue(async () => 42)).resolves.toBe(42);
  });
});

describe('synthesizeCached (F1603 + F1607)', () => {
  it('renders once then serves from cache', async () => {
    const db = freshDb();
    const adapter = new MockTtsAdapter();
    const rt = new TtsRuntime().register(adapter);
    const cache = new SynthesisCache(db);
    const queue = new SynthesisQueue();

    const a = await synthesizeCached(rt, cache, queue, { text: 'once', voiceId: 'mock-amy' });
    expect(a.cached).toBe(false);
    expect(adapter.calls).toBe(1);

    const b = await synthesizeCached(rt, cache, queue, { text: 'once', voiceId: 'mock-amy' });
    expect(b.cached).toBe(true);
    expect(adapter.calls).toBe(1); // no second render
    expect(Array.from(b.audio)).toEqual(Array.from(a.audio));
  });

  it('noCache forces a fresh render but still stores it', async () => {
    const db = freshDb();
    const adapter = new MockTtsAdapter();
    const rt = new TtsRuntime().register(adapter);
    const cache = new SynthesisCache(db);
    const queue = new SynthesisQueue();

    await synthesizeCached(rt, cache, queue, { text: 'x' });
    const fresh = await synthesizeCached(rt, cache, queue, { text: 'x' }, { noCache: true });
    expect(fresh.cached).toBe(false);
    expect(adapter.calls).toBe(2);
  });
});
