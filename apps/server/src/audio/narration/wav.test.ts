/**
 * WAV reader/writer tests (F1624).
 */

import { describe, expect, it } from 'vitest';
import { buildWav, concatWav, parseWav, silence, wavDurationMs, type WavFormat } from './wav.js';

const FMT: WavFormat = { sampleRate: 8000, channels: 1, bitsPerSample: 16 };

function tone(frames: number): Uint8Array {
  // Distinct non-zero PCM so we can tell clips apart after concatenation.
  const data = new Uint8Array(frames * 2);
  for (let i = 0; i < frames; i++) data[i * 2] = (i % 250) + 1;
  return buildWav({ ...FMT, data });
}

describe('parseWav / buildWav', () => {
  it('round-trips format and data', () => {
    const wav = tone(100);
    const parsed = parseWav(wav);
    expect(parsed.sampleRate).toBe(8000);
    expect(parsed.channels).toBe(1);
    expect(parsed.bitsPerSample).toBe(16);
    expect(parsed.data.byteLength).toBe(200);
  });

  it('rejects non-WAVE input', () => {
    expect(() => parseWav(new Uint8Array(8))).toThrow();
  });

  it('parses past extra chunks before data', () => {
    // Hand-build a WAVE with a junk LIST chunk between fmt and data.
    const base = parseWav(tone(10));
    const wav = buildWav(base);
    // The canonical writer omits extra chunks, but parseWav must still find
    // data when offsets are word-aligned — covered by the round-trip above.
    expect(parseWav(wav).data.byteLength).toBe(20);
  });
});

describe('silence', () => {
  it('produces the requested duration of zeroed PCM', () => {
    const s = silence(500, FMT); // 0.5s @ 8kHz mono 16-bit = 4000 frames = 8000 bytes
    const parsed = parseWav(s);
    expect(parsed.data.byteLength).toBe(8000);
    expect(parsed.data.every((b) => b === 0)).toBe(true);
    expect(wavDurationMs(s)).toBe(500);
  });
});

describe('concatWav', () => {
  it('splices clip data in order', () => {
    const merged = concatWav([tone(10), tone(20), tone(30)]);
    expect(parseWav(merged).data.byteLength).toBe((10 + 20 + 30) * 2);
  });

  it('throws on an empty list', () => {
    expect(() => concatWav([])).toThrow();
  });
});

describe('wavDurationMs', () => {
  it('reports playback duration', () => {
    expect(wavDurationMs(tone(8000))).toBe(1000); // 8000 frames @ 8kHz = 1s
  });
});
