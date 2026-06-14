/**
 * Ingest pipeline service (F761–F770).
 *
 * Orchestrates document ingestion:
 *   - Creates an ingest_jobs row
 *   - Runs the appropriate extractor (PDF, EPUB, HTML, URL)
 *   - Creates the result note with auto-tags (F767)
 *   - Reuses note creation pipeline so FTS and embeddings just work (F768)
 *
 * All extraction is async and runs after the HTTP response is sent (fire-and-forget
 * with the job row tracking progress). Callers can poll GET /ingest/jobs/:id.
 */

import type { NotebookId } from '@fables/core';
import type { Db } from '../db/connection.js';
import { ingestJobsRepo, type IngestSourceType } from '../db/repos/ingest-jobs.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import type { OcrProvider } from '../intelligence/ocr-provider.js';
import { extractEpub, epubChaptersToBody } from './epub-extractor.js';
import { extractHtml, fetchAndExtract } from './html-extractor.js';
import { extractPdf, pdfPagesToBody } from './pdf-extractor.js';
import { createNote } from '../services/notes.js';
import { tagsRepo } from '../db/repos/tags.js';
import type { IntelligenceService } from '../intelligence/index.js';

// A special "Clip Inbox" notebook is auto-created for web clips (F778).
export const CLIP_INBOX_NAME = 'Clip Inbox';

/** Find or create the clip inbox notebook (F778). */
export function ensureClipInbox(db: Db): NotebookId {
  const notebooks = notebooksRepo(db);
  const all = notebooks.list({ includeArchived: true });
  const existing = all.find((nb) => nb.name === CLIP_INBOX_NAME);
  if (existing) return existing.id;
  return notebooks.create({ name: CLIP_INBOX_NAME }).id;
}

/** Find or create the default "Inbox" notebook for ingested docs. */
function ensureInbox(db: Db): NotebookId {
  const notebooks = notebooksRepo(db);
  const all = notebooks.list({ includeArchived: true });
  const existing = all.find((nb) => nb.name === 'Inbox');
  if (existing) return existing.id;
  return notebooks.create({ name: 'Inbox' }).id;
}

/**
 * Auto-tag an ingested note by source type (F767).
 * Tags: pdf, epub, web-clip, audio-transcript — created on demand.
 */
function autoTagNote(db: Db, noteId: string, sourceType: IngestSourceType): void {
  const tags = tagsRepo(db);
  const tagMap: Record<IngestSourceType, string> = {
    pdf: 'pdf',
    epub: 'epub',
    html: 'web-clip',
    url: 'web-clip',
    audio: 'audio-transcript',
  };
  const tagName = tagMap[sourceType];
  const tag = tags.ensure(tagName);
  tags.linkNote(noteId as never, tag.id, false);
}

export interface IngestPdfInput {
  buffer: Buffer;
  filename: string;
  attachmentId?: string | null;
  notebookId?: NotebookId;
}

export interface IngestEpubInput {
  buffer: Buffer;
  filename: string;
  attachmentId?: string | null;
  notebookId?: NotebookId;
}

export interface IngestHtmlInput {
  html: string;
  sourceUrl: string;
  selection?: string | undefined;
  notebookId?: NotebookId | undefined;
}

export interface IngestUrlInput {
  url: string;
  selection?: string | undefined;
  notebookId?: NotebookId | undefined;
}

/**
 * Start a PDF ingest job (non-blocking). Returns the job row immediately.
 * The actual extraction runs async and updates the job row.
 */
export function startPdfIngest(
  db: Db,
  intel: IntelligenceService,
  ocr: OcrProvider,
  input: IngestPdfInput,
): ReturnType<ReturnType<typeof ingestJobsRepo>['create']> {
  const repo = ingestJobsRepo(db);
  const job = repo.create({
    sourceType: 'pdf',
    sourceName: input.filename,
    attachmentId: input.attachmentId ?? null,
  });

  // Fire-and-forget
  void (async () => {
    repo.setRunning(job.id);
    try {
      const result = await extractPdf(input.buffer, ocr, input.filename);
      repo.setProgress(job.id, result.pages.length, result.totalPages);
      const body = pdfPagesToBody(result.pages);
      const notebookId = input.notebookId ?? ensureInbox(db);
      const note = createNote(db, { notebookId, title: result.title, body });
      autoTagNote(db, note.id, 'pdf');
      repo.setDone(job.id, note.id);
      // Trigger embedding via queue (F768) — createNote already triggers FTS via DB trigger
      intel.queue.enqueue({
        sourceId: note.id,
        sourceType: 'note',
        title: note.title,
        body: note.body,
      });
    } catch (err) {
      if (db.open) repo.setFailed(job.id, String(err));
    }
  })();

  return job;
}

/**
 * Start an EPUB ingest job (non-blocking).
 */
export function startEpubIngest(
  db: Db,
  intel: IntelligenceService,
  input: IngestEpubInput,
): ReturnType<ReturnType<typeof ingestJobsRepo>['create']> {
  const repo = ingestJobsRepo(db);
  const job = repo.create({
    sourceType: 'epub',
    sourceName: input.filename,
    attachmentId: input.attachmentId ?? null,
  });

  void (async () => {
    repo.setRunning(job.id);
    try {
      const result = extractEpub(input.buffer, input.filename);
      repo.setProgress(job.id, result.chapters.length, result.chapters.length);
      const body = epubChaptersToBody(result);
      const notebookId = input.notebookId ?? ensureInbox(db);
      const note = createNote(db, { notebookId, title: result.bookTitle, body });
      autoTagNote(db, note.id, 'epub');
      repo.setDone(job.id, note.id);
      intel.queue.enqueue({
        sourceId: note.id,
        sourceType: 'note',
        title: note.title,
        body: note.body,
      });
    } catch (err) {
      if (db.open) repo.setFailed(job.id, String(err));
    }
  })();

  return job;
}

/**
 * Start an HTML ingest job (non-blocking).
 */
export function startHtmlIngest(
  db: Db,
  intel: IntelligenceService,
  input: IngestHtmlInput,
): ReturnType<ReturnType<typeof ingestJobsRepo>['create']> {
  const repo = ingestJobsRepo(db);
  const job = repo.create({
    sourceType: 'html',
    sourceName: input.sourceUrl,
    metadata: { sourceUrl: input.sourceUrl },
  });

  void (async () => {
    repo.setRunning(job.id);
    try {
      const result = await extractHtml(input.html, input.sourceUrl, input.selection);
      const notebookId = input.notebookId ?? ensureClipInbox(db);

      // Prepend metadata header (F776)
      const metaHeader = buildMetaHeader(result.metadata);
      const body = `${metaHeader}\n\n${result.markdownBody}`;

      const note = createNote(db, { notebookId, title: result.title, body });
      autoTagNote(db, note.id, 'html');
      repo.setDone(job.id, note.id);
      intel.queue.enqueue({
        sourceId: note.id,
        sourceType: 'note',
        title: note.title,
        body: note.body,
      });
    } catch (err) {
      // If the DB was closed under us (e.g. server shutdown mid-job), the job
      // result is moot — don't turn it into an unhandled rejection.
      if (db.open) repo.setFailed(job.id, String(err));
    }
  })();

  return job;
}

/**
 * Start a URL ingest job (fetches URL + extracts).
 */
export function startUrlIngest(
  db: Db,
  intel: IntelligenceService,
  input: IngestUrlInput,
): ReturnType<ReturnType<typeof ingestJobsRepo>['create']> {
  const repo = ingestJobsRepo(db);
  const job = repo.create({
    sourceType: 'url',
    sourceName: input.url,
    metadata: { sourceUrl: input.url },
  });

  void (async () => {
    repo.setRunning(job.id);
    try {
      const result = await fetchAndExtract(input.url, input.selection);
      const notebookId = input.notebookId ?? ensureClipInbox(db);
      const metaHeader = buildMetaHeader(result.metadata);
      const body = `${metaHeader}\n\n${result.markdownBody}`;
      const note = createNote(db, { notebookId, title: result.title, body });
      autoTagNote(db, note.id, 'url');
      repo.setDone(job.id, note.id);
      intel.queue.enqueue({
        sourceId: note.id,
        sourceType: 'note',
        title: note.title,
        body: note.body,
      });
    } catch (err) {
      if (db.open) repo.setFailed(job.id, String(err));
    }
  })();

  return job;
}

/** Build a Markdown metadata header for clipped notes (F776). */
function buildMetaHeader(metadata: {
  sourceUrl: string;
  siteName: string | null;
  clippedAt: string;
  byline: string | null;
  favicon: string | null;
}): string {
  const lines = [`**Source:** ${metadata.sourceUrl}`];
  if (metadata.siteName) lines.push(`**Site:** ${metadata.siteName}`);
  if (metadata.byline) lines.push(`**Author:** ${metadata.byline}`);
  lines.push(`**Clipped:** ${metadata.clippedAt}`);
  return lines.join('  \n');
}
