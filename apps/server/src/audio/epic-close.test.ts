/**
 * Epic 17 close — end-to-end audio pipeline (F1691 demo fable, F1692 cache
 * hit-rate, F1697 regression). Proves the whole Audio Fables backend composes:
 * a story is cast, its soundscape extracted, narrated to a scene, pre-rendered
 * to one audio file, packaged as an audiobook, and transcribed for captions —
 * all from a single source, all green.
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { extractSceneBindings } from './soundscape/bindings.js';
import { extractSoundTriggers } from './soundscape/triggers.js';
import { buildScene } from './narration/scene.js';
import { buildTimeline } from './narration/timeline.js';
import { prerenderScene, realtimeRatio } from './narration/prerender.js';
import { buildAudiobookManifest, toCueSheet } from './export/audiobook.js';
import { buildTranscript, buildVtt } from './a11y/transcript.js';
import { TtsRuntime } from './tts/runtime.js';
import { MockTtsAdapter } from './tts/mock-adapter.js';
import { SynthesisCache, SynthesisQueue, synthesizeCached } from './tts/synthesis.js';
import type { CastSheet } from './casting/resolve.js';

const DEMO = `=== tavern ===
# scene: tavern
The fire crackled in the hearth.
"Another ale?" asked the Barkeep.
~ play("door")
+ [Stay a while] -> road
+ [Head out] -> road

=== road ===
# scene: forest
The road wound north into the trees.
-> END
`;

const CAST: CastSheet = {
  narrator: { voiceId: 'mock-amy' },
  bySpeaker: { barkeep: { voiceId: 'mock-ben' } },
  defaultCharacter: { voiceId: 'mock-ben' },
};

describe('Epic 17 — full audio pipeline (F1691/F1697)', () => {
  it('casts, soundscapes, narrates, pre-renders, packages, and transcribes a fable', async () => {
    const path = ['tavern', 'road'];

    // 1. Soundscape extraction from the same source.
    const bindings = extractSceneBindings(DEMO);
    expect(bindings.map((b) => b.soundscape)).toEqual(['tavern', 'forest']);
    const triggers = extractSoundTriggers(DEMO);
    expect(triggers.some((t) => t.sound === 'door')).toBe(true);

    // 2. Narration scene + timeline using the cast.
    const scene = buildScene(DEMO, path, CAST);
    expect(scene.items.length).toBeGreaterThan(0);
    expect(scene.items.some((i) => i.kind === 'choice')).toBe(true);
    const timeline = buildTimeline(scene);
    expect(timeline.entries.length).toBe(scene.items.length);

    // 3. Pre-render to one baked WAV through the mock engine.
    const runtime = new TtsRuntime().register(new MockTtsAdapter());
    const baked = await prerenderScene(scene, (req) => runtime.synthesize(req));
    expect(baked.format).toBe('wav');
    expect(baked.audio.byteLength).toBeGreaterThan(0);
    expect(realtimeRatio(baked)).toBeGreaterThan(0);

    // 4. Audiobook packaging — chapters from the two knots.
    const manifest = buildAudiobookManifest(scene, { title: 'The Tavern Tale' }, 'm4b');
    expect(manifest.chapters.map((c) => c.knot)).toEqual(['tavern', 'road']);
    expect(toCueSheet(manifest)).toContain('TITLE "The Tavern Tale"');

    // 5. Accessible artifacts.
    const transcript = buildTranscript(scene);
    expect(transcript).toContain('Narrator: The fire crackled in the hearth.');
    expect(buildVtt(scene).startsWith('WEBVTT')).toBe(true);
  });

  it('synthesis cache reports a rising hit-rate (F1692)', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const runtime = new TtsRuntime().register(new MockTtsAdapter());
    const cache = new SynthesisCache(db);
    const queue = new SynthesisQueue();

    await synthesizeCached(runtime, cache, queue, { text: 'hello', voiceId: 'mock-amy' });
    await synthesizeCached(runtime, cache, queue, { text: 'hello', voiceId: 'mock-amy' });
    await synthesizeCached(runtime, cache, queue, { text: 'hello', voiceId: 'mock-amy' });

    const stats = cache.stats();
    expect(stats.entries).toBe(1);
    expect(stats.hits).toBe(2); // first was a miss, next two hits
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3);

    const freed = cache.clear();
    expect(freed).toBeGreaterThan(0);
    expect(cache.stats().entries).toBe(0);
  });
});
