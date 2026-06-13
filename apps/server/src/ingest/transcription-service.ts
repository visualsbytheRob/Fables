/**
 * Audio transcription service (F781–F790).
 *
 * Orchestrates voice memo ingestion:
 *   - Stores audio as an attachment (F781)
 *   - Creates a transcription_jobs row (F783)
 *   - Runs whisper when available (F782)
 *   - Creates a note with timestamped segments linking to audio position (F784)
 *   - FTS + embedding indexing via the standard note pipeline (F787)
 *   - Graceful degradation when whisper is unavailable (F782)
 *
 * The transcription job queue (F783) is polled by startTranscriptionRunner().
 * Status/retry tracking is in the transcription_jobs table.
 */

import type { NotebookId } from '@fables/core';
import type { Db } from '../db/connection.js';
import { transcriptionJobsRepo, type WhisperModelSize, type TranscriptionResult } from '../db/repos/transcription-jobs.js';
import { createNote } from '../services/notes.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { tagsRepo } from '../db/repos/tags.js';
import type { IntelligenceService } from '../intelligence/index.js';
import type { WhisperProvider } from '../intelligence/whisper-provider.js';

/** Find or create the "Voice Memos" notebook for transcripts. */
export function ensureVoiceMemosNotebook(db: Db): NotebookId {
  const notebooks = notebooksRepo(db);
  const all = notebooks.list({ includeArchived: true });
  const existing = all.find((nb) => nb.name === 'Voice Memos');
  if (existing) return existing.id;
  return notebooks.create({ name: 'Voice Memos' }).id;
}

/**
 * Start a transcription job for an uploaded audio attachment (F782, F783).
 * Returns the job row immediately; transcription runs async.
 */
export function startTranscriptionJob(
  db: Db,
  intel: IntelligenceService,
  whisper: WhisperProvider,
  input: {
    attachmentId: string;
    audioBuffer: Buffer;
    audioFilename: string;
    modelSize?: WhisperModelSize | undefined;
    notebookId?: NotebookId | undefined;
  },
): ReturnType<ReturnType<typeof transcriptionJobsRepo>['create']> {
  const repo = transcriptionJobsRepo(db);
  const job = repo.create({
    attachmentId: input.attachmentId,
    ...(input.modelSize !== undefined ? { modelSize: input.modelSize } : {}),
  });

  void (async () => {
    repo.setRunning(job.id);
    try {
      if (!whisper.available()) {
        throw new Error(
          'Whisper is unavailable — install openai-whisper (pip install openai-whisper) to enable transcription. ' +
          `Set FABLES_WHISPER_MODEL to 'tiny', 'base', 'small', 'medium', or 'large' (F789).`,
        );
      }

      const result: TranscriptionResult = await whisper.transcribe(
        input.audioBuffer,
        input.modelSize,
      );

      // Build transcript note body with timestamped segment links (F784)
      const notebookId = input.notebookId ?? ensureVoiceMemosNotebook(db);
      const title = `Transcript: ${input.audioFilename}`;
      const body = buildTranscriptBody(result, input.attachmentId);

      const note = createNote(db, { notebookId, title, body });

      // Auto-tag transcript notes
      const tags = tagsRepo(db);
      const tag = tags.ensure('audio-transcript');
      tags.linkNote(note.id as never, tag.id, false);

      repo.setDone(job.id, note.id, result);

      // FTS + embedding indexing (F787)
      intel.queue.enqueue({ sourceId: note.id, sourceType: 'note', title: note.title, body: note.body });
    } catch (err) {
      repo.setFailed(job.id, String(err));
    }
  })();

  return job;
}

/**
 * Build note body from transcript result (F784).
 * Includes timestamped segments with links to audio position.
 * Format: `[MM:SS] text` for each segment, with speaker labels (F788).
 */
function buildTranscriptBody(result: TranscriptionResult, attachmentId: string): string {
  const lines: string[] = [];

  if (result.language) {
    lines.push(`*Language: ${result.language}*`);
  }
  if (result.duration !== undefined) {
    const mins = Math.floor(result.duration / 60);
    const secs = Math.floor(result.duration % 60);
    lines.push(`*Duration: ${mins}:${secs.toString().padStart(2, '0')}*`);
  }
  lines.push('');
  lines.push(`<!-- attachment:${attachmentId} -->`);
  lines.push('');

  let lastSpeaker: string | undefined;
  for (const seg of result.segments) {
    const timestamp = formatTimestamp(seg.start);
    // Add speaker label when it changes (F788)
    if (seg.speaker && seg.speaker !== lastSpeaker) {
      lines.push(`\n**${seg.speaker}**`);
      lastSpeaker = seg.speaker;
    }
    // Timestamp links use #t=seconds fragment for audio seeking
    lines.push(`[${timestamp}](#t=${Math.floor(seg.start)}) ${seg.text}`);
  }

  return lines.join('\n');
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Simple transcription job runner (F783) — picks up queued jobs and runs them.
 * In production this would be called on a timer; in tests it's called directly.
 */
export async function runPendingTranscriptionJobs(
  db: Db,
  intel: IntelligenceService,
  whisper: WhisperProvider,
): Promise<{ processed: number; failed: number }> {
  const repo = transcriptionJobsRepo(db);
  const pending = repo.pendingJobs();
  let processed = 0;
  let failed = 0;

  for (const job of pending) {
    repo.setRunning(job.id);
    try {
      if (!whisper.available()) {
        throw new Error('Whisper unavailable');
      }
      // In a real runner we'd fetch the audio from disk here
      // For now we mark as failed with a clear message since we don't have the buffer
      throw new Error('Job runner: audio buffer not cached — resubmit via POST /transcribe');
    } catch (err) {
      repo.setFailed(job.id, String(err));
      failed++;
    }
    processed++;
  }

  return { processed, failed };
}
