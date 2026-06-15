/**
 * Text-to-speech routes (Epic 17, Audio Fables).
 *
 *  GET  /tts/status                — engine availability + voice catalog (F1602)
 *  GET  /tts/settings              — per-vault voice settings (F1608)
 *  PUT  /tts/settings              — update voice settings (F1608)
 *  POST /tts/synthesize            — render speech, cached by content (F1603)
 *
 * Speech is always optional: when no engine is available, /tts/status reports
 * `{ available: false }` so the web layer can fall back to the browser's Web
 * Speech API (F1604) or hide playback. The synthesis pipeline expands speech
 * markup (F1606) and applies the pronunciation lexicon (F1605) before a request
 * reaches an engine.
 */

import { validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { SynthesisCache, SynthesisQueue, synthesizeCached } from '../audio/tts/synthesis.js';
import { ttsSettingsRepo } from '../audio/tts/settings.js';
import { parseSpeechMarkup, segmentsToPlainText } from '../audio/tts/markup.js';
import { applyLexicon, parseLexicon } from '../audio/tts/lexicon.js';

registerRoute({ method: 'GET', path: '/tts/status', summary: 'Speech engine + voices (F1602)' });
registerRoute({ method: 'GET', path: '/tts/settings', summary: 'Voice settings (F1608)' });
registerRoute({ method: 'PUT', path: '/tts/settings', summary: 'Update voice settings (F1608)' });
registerRoute({
  method: 'POST',
  path: '/tts/synthesize',
  summary: 'Render speech, cached by content (F1603)',
});
registerRoute({ method: 'GET', path: '/tts/cache', summary: 'Synthesis cache hit-rate (F1692)' });
registerRoute({
  method: 'DELETE',
  path: '/tts/cache',
  summary: 'Clear the synthesis cache (F1693)',
});

const settingsBody = z.object({
  defaultVoiceId: z.string().min(1).nullable().optional(),
  rate: z.number().min(0.25).max(4).optional(),
  pitch: z.number().min(0.25).max(4).optional(),
  disabled: z.boolean().optional(),
  cacheBudgetMb: z.number().int().min(1).max(10_000).optional(),
  lexicon: z.string().max(200_000).optional(),
});

const synthBody = z.object({
  /** Text, optionally with speech markup (F1606). */
  text: z.string().min(1).max(50_000),
  /** Engine voice id; falls back to the vault default then the engine default. */
  voiceId: z.string().min(1).optional(),
  rate: z.number().min(0.25).max(4).optional(),
  pitch: z.number().min(0.25).max(4).optional(),
  /** Higher renders sooner under load (F1607). */
  priority: z.number().int().min(0).max(100).optional(),
  /** Force a fresh render (still cached). */
  noCache: z.boolean().optional(),
});

export const ttsRoutes: FastifyPluginAsync = async (app) => {
  // One cache + queue per app instance; the runtime is decorated on the app.
  const cache = new SynthesisCache(app.db);
  const queue = new SynthesisQueue();
  const settings = ttsSettingsRepo(app.db);

  app.get('/tts/status', async () => {
    const available = await app.tts.isAvailable();
    const voices = await app.tts.listVoices();
    return { data: { available, voices, cacheBytes: cache.totalBytes() } };
  });

  app.get('/tts/cache', async () => {
    return { data: cache.stats() };
  });

  app.delete('/tts/cache', async () => {
    const freed = cache.clear();
    return { data: { cleared: true, bytesFreed: freed } };
  });

  app.get('/tts/settings', async () => {
    return { data: settings.get() };
  });

  app.put('/tts/settings', async (request) => {
    const patch = parseWith(settingsBody, request.body, 'body');
    const next = settings.update(patch);
    // Reflect the disable flag onto the live runtime immediately.
    app.tts.setDisabled(next.disabled);
    return { data: next };
  });

  app.post('/tts/synthesize', async (request) => {
    const body = parseWith(synthBody, request.body, 'body');
    if (!(await app.tts.isAvailable())) {
      throw validation('no speech engine is available', { available: false });
    }

    const cfg = settings.get();
    // Expand markup → segments, apply the lexicon, flatten to engine-ready text.
    const lexicon = parseLexicon(cfg.lexicon);
    const segments = parseSpeechMarkup(body.text);
    const plain = applyLexicon(segmentsToPlainText(segments), lexicon);

    const result = await synthesizeCached(
      app.tts,
      cache,
      queue,
      {
        text: plain,
        ...((body.voiceId ?? cfg.defaultVoiceId)
          ? { voiceId: body.voiceId ?? cfg.defaultVoiceId! }
          : {}),
        rate: body.rate ?? cfg.rate,
        pitch: body.pitch ?? cfg.pitch,
      },
      {
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.noCache !== undefined ? { noCache: body.noCache } : {}),
      },
    );

    // Enforce the soft cache budget after writing (LRU eviction).
    cache.evictToFit(cfg.cacheBudgetMb * 1024 * 1024);

    return {
      data: {
        voiceId: result.voiceId,
        format: result.format,
        sampleRate: result.sampleRate,
        durationMs: result.durationMs ?? null,
        cached: result.cached,
        bytes: result.audio.byteLength,
        /** base64 audio so the JSON envelope stays uniform; small for cached reads. */
        audio: Buffer.from(result.audio).toString('base64'),
        segments,
      },
    };
  });
};
