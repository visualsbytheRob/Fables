/**
 * Minimal RIFF/WAVE reader + writer (Epic 17, F1624 pre-render).
 *
 * Just enough to parse the PCM WAV a Piper-class engine emits, generate silence
 * in the same format, and concatenate clips into one baked narration file. We
 * scan the chunk list (rather than assuming a fixed 44-byte header) so files
 * with extra `LIST`/`fact` chunks still parse. No external dependency.
 */

export interface WavFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export interface WavData extends WavFormat {
  /** Raw PCM sample bytes (the contents of the `data` chunk). */
  data: Uint8Array;
}

const RIFF = 0x46464952; // "RIFF" little-endian
const WAVE = 0x45564157; // "WAVE"
const FMT = 0x20746d66; // "fmt "
const DATA = 0x61746164; // "data"

/** Parse a PCM WAV buffer into its format + raw sample bytes. */
export function parseWav(bytes: Uint8Array): WavData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength < 12 ||
    view.getUint32(0, true) !== RIFF ||
    view.getUint32(8, true) !== WAVE
  ) {
    throw new Error('not a RIFF/WAVE file');
  }

  let fmt: WavFormat | null = null;
  let data: Uint8Array | null = null;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === FMT && body + 16 <= bytes.byteLength) {
      fmt = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === DATA) {
      const end = Math.min(body + size, bytes.byteLength);
      data = bytes.subarray(body, end);
    }
    // Chunks are word-aligned: an odd size carries a trailing pad byte.
    offset = body + size + (size % 2);
  }

  if (!fmt) throw new Error('WAVE has no fmt chunk');
  if (!data) throw new Error('WAVE has no data chunk');
  return { ...fmt, data };
}

/** Build a canonical 44-byte-header PCM WAV from a format + sample bytes. */
export function buildWav(input: WavData): Uint8Array {
  const { sampleRate, channels, bitsPerSample, data } = input;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const out = new Uint8Array(44 + data.byteLength);
  const view = new DataView(out.buffer);

  view.setUint32(0, RIFF, true);
  view.setUint32(4, 36 + data.byteLength, true);
  view.setUint32(8, WAVE, true);
  view.setUint32(12, FMT, true);
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, DATA, true);
  view.setUint32(40, data.byteLength, true);
  out.set(data, 44);
  return out;
}

/** Generate `ms` of silence (zeroed PCM) in `fmt`. */
export function silence(ms: number, fmt: WavFormat): Uint8Array {
  const blockAlign = (fmt.channels * fmt.bitsPerSample) / 8;
  const frames = Math.max(0, Math.round((ms / 1000) * fmt.sampleRate));
  return buildWav({ ...fmt, data: new Uint8Array(frames * blockAlign) });
}

/**
 * Concatenate PCM WAV clips into one. All clips are resampled-by-assumption to
 * the first clip's format (engines emit a single fixed format), so we simply
 * splice their `data` chunks. Throws on an empty list.
 */
export function concatWav(clips: Uint8Array[]): Uint8Array {
  if (clips.length === 0) throw new Error('concatWav: no clips');
  const parsed = clips.map(parseWav);
  const fmt = parsed[0]!;
  const total = parsed.reduce((n, c) => n + c.data.byteLength, 0);
  const merged = new Uint8Array(total);
  let at = 0;
  for (const clip of parsed) {
    merged.set(clip.data, at);
    at += clip.data.byteLength;
  }
  return buildWav({
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    data: merged,
  });
}

/** Playback duration of a PCM WAV in milliseconds. */
export function wavDurationMs(bytes: Uint8Array): number {
  const wav = parseWav(bytes);
  const blockAlign = (wav.channels * wav.bitsPerSample) / 8;
  if (blockAlign === 0 || wav.sampleRate === 0) return 0;
  const frames = wav.data.byteLength / blockAlign;
  return Math.round((frames / wav.sampleRate) * 1000);
}
