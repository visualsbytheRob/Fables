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

const MOCK_SAMPLE_RATE = 8000;

/** A valid 8 kHz mono 16-bit PCM WAV whose length tracks the text, so pre-render
 *  (which parses + concatenates real WAV clips) works against the mock. */
function mockWav(text: string): Uint8Array {
  const frames = Math.max(1, text.length) * 80; // 10ms of audio per character
  const dataBytes = frames * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46464952, true); // "RIFF"
  view.setUint32(4, 36 + dataBytes, true);
  view.setUint32(8, 0x45564157, true); // "WAVE"
  view.setUint32(12, 0x20746d66, true); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, MOCK_SAMPLE_RATE, true);
  view.setUint32(28, MOCK_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x61746164, true); // "data"
  view.setUint32(40, dataBytes, true);
  // Non-zero samples derived from the text so distinct lines differ.
  for (let i = 0; i < text.length; i++) out[44 + i] = text.charCodeAt(i) & 0xff;
  return out;
}

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
    return {
      audio: mockWav(req.text),
      format: 'wav',
      sampleRate: MOCK_SAMPLE_RATE,
      voiceId,
      durationMs: req.text.length * 10,
    };
  }
}
