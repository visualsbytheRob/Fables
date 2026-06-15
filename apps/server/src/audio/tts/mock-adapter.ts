/**
 * In-memory mock speech engine (F1610 tests). Renders a tiny deterministic WAV
 * header + a byte per character so tests can assert caching, queueing and
 * routing without a real synthesis binary.
 */

import type { SynthesisRequest, SynthesisResult, TtsAdapter, Voice } from './adapter.js';

const VOICES: Voice[] = [
  { id: 'mock-amy', name: 'Amy (mock)', lang: 'en-US', gender: 'female', quality: 'medium' },
  { id: 'mock-ben', name: 'Ben (mock)', lang: 'en-GB', gender: 'male', quality: 'high' },
];

export class MockTtsAdapter implements TtsAdapter {
  readonly name = 'mock';
  available = true;
  /** Count of real synthesise calls — lets tests prove the cache short-circuits. */
  calls = 0;

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async listVoices(): Promise<Voice[]> {
    return VOICES;
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    this.calls++;
    const voiceId = req.voiceId ?? VOICES[0]!.id;
    // One byte per character of input — enough to make distinct texts distinct.
    const audio = new Uint8Array(Math.max(1, req.text.length));
    for (let i = 0; i < req.text.length; i++) audio[i] = req.text.charCodeAt(i) & 0xff;
    return {
      audio,
      format: 'wav',
      sampleRate: 22_050,
      voiceId,
      durationMs: req.text.length * 50,
    };
  }
}
