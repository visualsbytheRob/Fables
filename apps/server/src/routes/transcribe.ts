/**
 * Audio transcription routes (F781–F790).
 *
 * POST /transcribe          — upload audio + create transcription job (F781, F782, F783)
 * GET  /transcribe/jobs/:id — poll job status (F783)
 * GET  /transcribe/jobs     — list transcription jobs
 *
 * Features:
 *   F781: voice memo stored as attachment
 *   F782: Whisper transcription (graceful — unavailable when whisper not installed)
 *   F783: job queue with status/retry
 *   F784: transcript note with timestamped segments linking to audio position
 *   F787: transcripts FTS+embedding indexed via note pipeline
 *   F788: silence-based speaker segmentation stub
 *   F789: model-size setting via ?model=base
 *
 * Skipped (web-only):
 *   F785: audio player UI
 *   F786: record/capture UI
 *   F781 capture button (web)
 */

import multipart from '@fastify/multipart';
import { AppError, notFound, validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { paginated, parsePagination } from '../api/envelope.js';
import { transcriptionJobsRepo, type WhisperModelSize } from '../db/repos/transcription-jobs.js';
import { attachmentsRepo } from '../db/repos/attachments.js';
import { unavailableWhisperProvider } from '../intelligence/whisper-provider.js';
import { startTranscriptionJob } from '../ingest/transcription-service.js';
import { sha256Hex } from '../lib/hash.js';
import { saveAttachmentFile } from '../attachments/store.js';
import type { NotebookId } from '@fables/core';

const AUDIO_MAX_BYTES = 200 * 1024 * 1024; // 200 MB — voice memos can be long

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/mpeg', 'audio/mp3',
  'audio/mp4', 'audio/x-m4a',
  'audio/ogg', 'audio/webm',
  'audio/flac', 'audio/x-flac',
]);

const idParamsSchema = z.object({ id: z.string().min(1) });
const modelSizes = ['tiny', 'base', 'small', 'medium', 'large'] as const;

registerRoute({
  method: 'POST',
  path: '/transcribe',
  summary: 'Upload audio + start transcription job (F781, F782, F783)',
});
registerRoute({
  method: 'GET',
  path: '/transcribe/jobs',
  summary: 'List transcription jobs',
});
registerRoute({
  method: 'GET',
  path: '/transcribe/jobs/:id',
  summary: 'Fetch a transcription job',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/transcribe/jobs/:id/retry',
  summary: 'Retry a failed transcription job',
  params: idParamsSchema,
});

export const transcribeRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, {
    limits: { fileSize: AUDIO_MAX_BYTES, files: 1 },
  });

  /** POST /transcribe — multipart audio file upload */
  app.post('/transcribe', async (request, reply) => {
    if (!request.isMultipart()) throw validation('expected multipart/form-data');

    const part = await request.file();
    if (!part) throw validation('missing audio file in multipart form');

    // Read model size from form fields (before toBuffer — fields precede the file)
    const modelField = part.fields['model'];
    const modelFieldVal =
      modelField && !Array.isArray(modelField) && modelField.type === 'field'
        ? String(modelField.value)
        : 'base';
    const modelSize: WhisperModelSize =
      (modelSizes as readonly string[]).includes(modelFieldVal)
        ? (modelFieldVal as WhisperModelSize)
        : 'base';

    const notebookField = part.fields['notebookId'];
    const notebookId =
      notebookField && !Array.isArray(notebookField) && notebookField.type === 'field'
        ? String(notebookField.value) as NotebookId
        : undefined;

    let content: Buffer;
    try {
      content = await part.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError('PAYLOAD_TOO_LARGE', `audio file exceeds the ${AUDIO_MAX_BYTES / 1024 / 1024} MB limit`, {
          details: { limitBytes: AUDIO_MAX_BYTES },
        });
      }
      throw err;
    }

    const mime = part.mimetype;
    const filename = part.filename || 'recording.wav';

    if (!ALLOWED_AUDIO_MIMES.has(mime) && !mime.startsWith('audio/')) {
      throw validation(
        `file type "${mime}" is not an audio format — expected audio/wav, audio/mpeg, etc.`,
        { mime },
      );
    }

    // Store audio as attachment (F781)
    const hash = sha256Hex(content);
    saveAttachmentFile(app.dataDir, hash, content);
    const attachment = attachmentsRepo(app.db).create({
      noteId: null,
      filename,
      mime,
      size: content.byteLength,
      hash,
    });

    // Start transcription job (F782, F783) — whisper gracefully unavailable by default
    const job = startTranscriptionJob(app.db, app.intel, unavailableWhisperProvider, {
      attachmentId: attachment.id,
      audioBuffer: content,
      audioFilename: filename,
      modelSize,
      ...(notebookId !== undefined ? { notebookId } : {}),
    });

    reply.status(202);
    return {
      data: job,
      attachment: { id: attachment.id, filename, mime, size: content.byteLength },
      whisperAvailable: unavailableWhisperProvider.available(),
    };
  });

  /** GET /transcribe/jobs */
  app.get('/transcribe/jobs', async (request) => {
    const pagination = parsePagination(request.query);
    const rows = transcriptionJobsRepo(app.db).list({ limit: pagination.limit + 1 });
    return paginated(rows, pagination);
  });

  /** GET /transcribe/jobs/:id */
  app.get('/transcribe/jobs/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const job = transcriptionJobsRepo(app.db).get(id);
    if (!job) throw notFound('TranscriptionJob', id);
    return { data: job };
  });

  /** POST /transcribe/jobs/:id/retry — re-queue a failed job */
  app.post('/transcribe/jobs/:id/retry', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const repo = transcriptionJobsRepo(app.db);
    const job = repo.get(id);
    if (!job) throw notFound('TranscriptionJob', id);
    if (job.status !== 'failed') {
      throw validation('only failed jobs can be retried', { status: job.status });
    }
    repo.requeue(id);
    return { data: repo.get(id) };
  });
};
