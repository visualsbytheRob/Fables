/**
 * Whisper transcription provider (F782).
 *
 * Design: graceful-degradation, matching the EmbeddingProvider/OcrProvider pattern.
 *
 * The default stub reports available()=false so tests and fresh installs
 * never crash — jobs are queued but will fail gracefully with a clear message.
 *
 * To enable real transcription:
 *   1. Install whisper binary: `pip install openai-whisper` (adds `whisper` to PATH)
 *      OR install whisper.cpp and point FABLES_WHISPER_BIN at the binary.
 *   2. Set FABLES_WHISPER_MODEL to the model size: tiny|base|small|medium|large (F789).
 *      The model is auto-downloaded by whisper on first use.
 *   3. Alternatively install @xenova/transformers (Whisper in Node.js, no Python needed)
 *      and adapt createWhisperProvider() to use it — the interface is the same.
 *
 * Silence-based speaker segmentation stub (F788):
 *   When result segments arrive with >1s gaps between them, each gap is treated
 *   as a potential speaker change and the "SPEAKER N" label is assigned.
 *   This is a heuristic only — real diarisation requires pyannote or similar.
 *
 * Model-size setting (F789):
 *   Controlled by FABLES_WHISPER_MODEL env var (default: 'base').
 *   Clients can override per-job via the modelSize field in TranscriptionJob.
 */

import type { TranscriptSegment, TranscriptionResult, WhisperModelSize } from '../db/repos/transcription-jobs.js';

export interface WhisperProvider {
  /** Whether whisper binary/package is installed and callable. */
  available(): boolean;
  /** Transcribe audio from a buffer. Returns structured segments. */
  transcribe(audioBuffer: Buffer, modelSize?: WhisperModelSize): Promise<TranscriptionResult>;
}

/** Default stub — always unavailable. Zero deps, never crashes. */
export const unavailableWhisperProvider: WhisperProvider = {
  available(): boolean {
    return false;
  },
  async transcribe(_audioBuffer: Buffer, _modelSize?: WhisperModelSize): Promise<TranscriptionResult> {
    throw new Error(
      'Whisper is unavailable — install openai-whisper (pip install openai-whisper) to enable transcription. ' +
      'Set FABLES_WHISPER_MODEL to control the model size (tiny/base/small/medium/large).',
    );
  },
};

/**
 * Silence-based speaker segmentation heuristic (F788).
 * Assigns "SPEAKER 1", "SPEAKER 2", etc. when there are >1s gaps between segments.
 * This is purely heuristic — no actual speaker identification.
 */
export function applySpeakerHeuristics(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length === 0) return segments;
  const SILENCE_THRESHOLD_SECS = 1.0;
  let speakerIndex = 1;
  let lastEnd = 0;
  return segments.map((seg, i) => {
    if (i > 0 && seg.start - lastEnd > SILENCE_THRESHOLD_SECS) {
      speakerIndex++;
    }
    lastEnd = seg.end;
    return { ...seg, speaker: `SPEAKER ${speakerIndex}` };
  });
}

/**
 * Factory that tries to run whisper via child_process.
 * Returns unavailableWhisperProvider if the binary is missing.
 *
 * Usage:
 *   const whisper = await createWhisperProvider();
 *   if (whisper.available()) {
 *     const result = await whisper.transcribe(audioBuffer, 'base');
 *   }
 */
export async function createWhisperProvider(): Promise<WhisperProvider> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    // Check if whisper binary is in PATH
    try {
      await execFileAsync('whisper', ['--help'], { timeout: 5000 });
    } catch (err) {
      const msg = String(err);
      if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('No such file')) {
        return unavailableWhisperProvider;
      }
      // --help may exit nonzero but still means it's installed
    }

    return {
      available(): boolean {
        return true;
      },
      async transcribe(audioBuffer: Buffer, modelSize: WhisperModelSize = 'base'): Promise<TranscriptionResult> {
        const fs = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-whisper-'));
        const inputFile = path.join(tmpDir, 'audio.wav');
        const outputDir = tmpDir;
        try {
          fs.writeFileSync(inputFile, audioBuffer);
          await execFileAsync('whisper', [
            inputFile,
            '--model', modelSize,
            '--output_format', 'json',
            '--output_dir', outputDir,
            '--verbose', 'False',
          ], { timeout: 300_000 });

          const jsonFile = path.join(outputDir, 'audio.json');
          if (!fs.existsSync(jsonFile)) {
            throw new Error('whisper did not produce output JSON');
          }
          const raw = JSON.parse(fs.readFileSync(jsonFile, 'utf8')) as {
            segments?: { start: number; end: number; text: string }[];
            language?: string;
          };
          const segments: TranscriptSegment[] = (raw.segments ?? []).map((s) => ({
            start: s.start,
            end: s.end,
            text: s.text.trim(),
          }));
          const withSpeakers = applySpeakerHeuristics(segments);
          const duration = segments.length > 0 ? segments[segments.length - 1]!.end : 0;
          const result: TranscriptionResult = { segments: withSpeakers, duration };
          if (raw.language !== undefined) result.language = raw.language;
          return result;
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    };
  } catch {
    return unavailableWhisperProvider;
  }
}
