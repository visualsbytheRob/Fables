/**
 * TTS route tests (Epic 17) — graceful degradation + the synthesis path.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MockTtsAdapter } from '../audio/tts/mock-adapter.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

describe('TTS — graceful when no engine (F1604)', () => {
  it('GET /tts/status reports unavailable (only the offline Piper adapter)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tts/status' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { available: boolean } }).data.available).toBe(false);
  });

  it('POST /tts/synthesize 422s with available:false rather than crashing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tts/synthesize',
      payload: { text: 'hello' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('TTS settings (F1608)', () => {
  it('round-trips voice settings', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/tts/settings',
      payload: { defaultVoiceId: 'mock-amy', rate: 1.2, lexicon: 'Mira: MEE-ra' },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/v1/tts/settings' });
    const data = (get.json() as { data: { defaultVoiceId: string; rate: number } }).data;
    expect(data.defaultVoiceId).toBe('mock-amy');
    expect(data.rate).toBe(1.2);
  });
});

describe('TTS — with an engine (F1603/F1606)', () => {
  beforeAll(() => {
    app.tts.register(new MockTtsAdapter());
  });

  it('synthesizes, expands markup, and caches the second read', async () => {
    const body = { text: 'Hello *there* [pause 200] friend', voiceId: 'mock-amy' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/tts/synthesize',
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    const a = (
      first.json() as {
        data: { cached: boolean; audio: string; format: string; segments: unknown[] };
      }
    ).data;
    expect(a.cached).toBe(false);
    expect(a.format).toBe('wav');
    expect(a.audio.length).toBeGreaterThan(0);
    expect(a.segments.length).toBeGreaterThan(0);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/tts/synthesize',
      payload: body,
    });
    expect((second.json() as { data: { cached: boolean } }).data.cached).toBe(true);
  });

  it('GET /tts/status now lists voices', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tts/status' });
    const data = (res.json() as { data: { available: boolean; voices: unknown[] } }).data;
    expect(data.available).toBe(true);
    expect(data.voices.length).toBeGreaterThan(0);
  });
});
