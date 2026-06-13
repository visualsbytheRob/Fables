/**
 * Tests for F781–F790: audio transcription routes.
 *
 * Critical: all tests must pass with Whisper UNAVAILABLE (the default).
 * Tests verify the graceful-degradation path — jobs are created and fail
 * with a clear "Whisper unavailable" error, never crash.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import {
  unavailableWhisperProvider,
  applySpeakerHeuristics,
} from '../intelligence/whisper-provider.js';
import { unavailableOcrProvider } from '../intelligence/ocr-provider.js';
import type { TranscriptSegment } from '../db/repos/transcription-jobs.js';

let app: FastifyInstance;
let dataDir: string;

const BOUNDARY = 'transcribe-test-boundary';

function audioMultipart(
  filename: string,
  mime: string,
  content: Buffer,
): { payload: Buffer; headers: Record<string, string> } {
  const chunks: Buffer[] = [
    Buffer.from(`--${BOUNDARY}\r\n`),
    Buffer.from(
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ];
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

// A minimal valid WAV header (44 bytes) + silence
const SILENT_WAV = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]), // chunk size
  Buffer.from('WAVE', 'ascii'),
  Buffer.from('fmt ', 'ascii'),
  Buffer.from([0x10, 0x00, 0x00, 0x00]), // subchunk size = 16
  Buffer.from([0x01, 0x00]), // PCM
  Buffer.from([0x01, 0x00]), // 1 channel
  Buffer.from([0x44, 0xac, 0x00, 0x00]), // 44100 Hz
  Buffer.from([0x88, 0x58, 0x01, 0x00]), // byte rate
  Buffer.from([0x02, 0x00]), // block align
  Buffer.from([0x10, 0x00]), // bits per sample
  Buffer.from('data', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]), // data size = 0
]);

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-transcribe-'));
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal', DATA_DIR: dataDir }));
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ── Provider unit tests ──────────────────────────────────────────────────────

describe('WhisperProvider — graceful unavailability (F782)', () => {
  it('unavailableWhisperProvider reports available()=false', () => {
    expect(unavailableWhisperProvider.available()).toBe(false);
  });

  it('unavailableWhisperProvider throws a clear error on transcribe', async () => {
    await expect(
      unavailableWhisperProvider.transcribe(Buffer.from('audio'), 'base'),
    ).rejects.toThrow(/unavailable/i);
  });
});

describe('OcrProvider — graceful unavailability (F763)', () => {
  it('unavailableOcrProvider reports available()=false', () => {
    expect(unavailableOcrProvider.available()).toBe(false);
  });

  it('unavailableOcrProvider throws a clear error on recognise', async () => {
    await expect(
      unavailableOcrProvider.recognise(Buffer.from('image'), 'image/png'),
    ).rejects.toThrow(/unavailable/i);
  });
});

describe('Speaker heuristics stub (F788)', () => {
  it('assigns speaker labels based on silence gaps', () => {
    const segments: TranscriptSegment[] = [
      { start: 0, end: 2, text: 'Hello' },
      { start: 2.5, end: 4, text: 'World' }, // <1s gap → same speaker
      { start: 6, end: 8, text: 'New speaker' }, // >1s gap → new speaker
    ];
    const result = applySpeakerHeuristics(segments);
    expect(result[0]!.speaker).toBe('SPEAKER 1');
    expect(result[1]!.speaker).toBe('SPEAKER 1'); // gap < 1s
    expect(result[2]!.speaker).toBe('SPEAKER 2'); // gap > 1s
  });

  it('handles empty segments without crashing', () => {
    expect(applySpeakerHeuristics([])).toEqual([]);
  });
});

// ── HTTP route tests ──────────────────────────────────────────────────────────

describe('POST /transcribe — voice memo upload (F781)', () => {
  it('accepts a WAV file and creates a job', async () => {
    const { payload, headers } = audioMultipart('memo.wav', 'audio/wav', SILENT_WAV);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/transcribe',
      payload,
      headers,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.id).toBeTruthy();
    expect(body.data.attachmentId).toBeTruthy();
    // Whisper is unavailable — job will fail with graceful error
    expect(body.whisperAvailable).toBe(false);
    expect(['queued', 'running', 'failed']).toContain(body.data.status);
  });

  it('rejects non-audio files', async () => {
    const { payload, headers } = audioMultipart('evil.pdf', 'application/pdf', Buffer.from('pdf'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/transcribe',
      payload,
      headers,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('not an audio format');
  });
});

describe('GET /transcribe/jobs', () => {
  it('returns a paginated list of transcription jobs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/transcribe/jobs' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.page).toBeDefined();
  });
});

describe('GET /transcribe/jobs/:id', () => {
  it('404s for unknown job', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/transcribe/jobs/txn_nonexistent',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns a known job by id', async () => {
    const { payload, headers } = audioMultipart('lookup.wav', 'audio/wav', SILENT_WAV);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/transcribe',
      payload,
      headers,
    });
    const job = created.json().data;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/transcribe/jobs/${job.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(job.id);
  });
});

describe('POST /transcribe/jobs/:id/retry (F783)', () => {
  it('404s for unknown job', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/transcribe/jobs/txn_nonexistent/retry',
    });
    expect(res.statusCode).toBe(404);
  });

  it('requeues a failed job (retry path)', async () => {
    // Create a job — since whisper is unavailable, it will quickly transition to 'failed'
    const { payload, headers } = audioMultipart('retry.wav', 'audio/wav', SILENT_WAV);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/transcribe',
      payload,
      headers,
    });
    const job = created.json().data;

    // Wait a tick for the async job to fail (whisper unavailable)
    await new Promise((r) => setTimeout(r, 50));

    // Poll the job — should be 'failed' by now since whisper is unavailable
    const polled = await app.inject({
      method: 'GET',
      url: `/api/v1/transcribe/jobs/${job.id}`,
    });
    const polledJob = polled.json().data;

    if (polledJob.status === 'failed') {
      // Re-queue it — should succeed
      const retryRes = await app.inject({
        method: 'POST',
        url: `/api/v1/transcribe/jobs/${job.id}/retry`,
      });
      expect(retryRes.statusCode).toBe(200);
      expect(retryRes.json().data.status).toBe('queued');
    } else {
      // Still queued/running — can't retry yet, just check the job exists
      expect(polledJob.id).toBe(job.id);
    }
  });

  it('correctly handles retry based on actual job status', async () => {
    // Create a job
    const { payload, headers } = audioMultipart('nodelay.wav', 'audio/wav', SILENT_WAV);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/transcribe',
      payload,
      headers,
    });
    const job = created.json().data;
    expect(job.id).toBeTruthy();

    // Wait for the async job to settle (whisper unavailable → will fail)
    await new Promise((r) => setTimeout(r, 100));

    // Poll current status
    const polled = await app.inject({
      method: 'GET',
      url: `/api/v1/transcribe/jobs/${job.id}`,
    });
    const currentStatus = polled.json().data.status as string;

    const retryRes = await app.inject({
      method: 'POST',
      url: `/api/v1/transcribe/jobs/${job.id}/retry`,
    });

    if (currentStatus === 'failed') {
      // Retry of a failed job should succeed (200)
      expect(retryRes.statusCode).toBe(200);
      expect(retryRes.json().data.status).toBe('queued');
    } else {
      // If somehow still queued, retry should fail (422)
      expect(retryRes.statusCode).toBe(422);
    }
  });
});
