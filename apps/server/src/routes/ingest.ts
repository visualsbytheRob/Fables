/**
 * Document ingestion routes (F761–F770).
 *
 * POST /ingest          — multipart file OR JSON {url}
 * GET  /ingest/jobs     — list all ingest jobs (paginated)
 * GET  /ingest/jobs/:id — fetch a single ingest job
 *
 * Supported source types:
 *   - PDF (application/pdf) → extracts text per page (F762)
 *   - EPUB (application/epub+zip) → extracts chapters (F764)
 *   - HTML (text/html) → Readability extraction (F765)
 *   - URL (JSON body {url}) → fetch + Readability (F765)
 *
 * Auto-tagging: ingested docs get a source-type tag (F767).
 * Auto-indexing: reuses createNote pipeline so FTS+embeddings just work (F768).
 * Large-file guardrails: PDF_MAX_PAGES / PDF_MAX_BYTES / EPUB_MAX_BYTES (F769).
 * OCR: graceful — OcrProvider.available() check, clear error if unavailable (F763).
 */

import multipart from '@fastify/multipart';
import { AppError, notFound, validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { paginated, parsePagination } from '../api/envelope.js';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { ingestJobsRepo } from '../db/repos/ingest-jobs.js';
import { unavailableOcrProvider } from '../intelligence/ocr-provider.js';
import {
  startEpubIngest,
  startHtmlIngest,
  startPdfIngest,
  startUrlIngest,
} from '../ingest/ingest-service.js';
import { sha256Hex } from '../lib/hash.js';
import { saveAttachmentFile } from '../attachments/store.js';
import { attachmentsRepo } from '../db/repos/attachments.js';
import type { NotebookId } from '@fables/core';
import { PDF_MAX_BYTES } from '../ingest/pdf-extractor.js';
import { EPUB_MAX_BYTES } from '../ingest/epub-extractor.js';
import { HTML_MAX_BYTES } from '../ingest/html-extractor.js';

const INGEST_MAX_FILE_BYTES = Math.max(PDF_MAX_BYTES, EPUB_MAX_BYTES, HTML_MAX_BYTES);

const idParamsSchema = z.object({ id: z.string().min(1) });

const urlBodySchema = z.object({
  url: z.string().url(),
  selection: z.string().optional(),
  notebookId: z.string().min(1).optional(),
});

registerRoute({
  method: 'POST',
  path: '/ingest',
  summary: 'Ingest a document (multipart PDF/EPUB/HTML or JSON {url})',
});
registerRoute({
  method: 'GET',
  path: '/ingest/jobs',
  summary: 'List ingest jobs (newest first)',
});
registerRoute({
  method: 'GET',
  path: '/ingest/jobs/:id',
  summary: 'Fetch a single ingest job',
  params: idParamsSchema,
});

export const ingestRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, {
    limits: { fileSize: INGEST_MAX_FILE_BYTES, files: 1 },
  });

  /** POST /ingest — multipart file upload or JSON {url} */
  app.post('/ingest', async (request, reply) => {
    const contentType = request.headers['content-type'] ?? '';

    if (contentType.includes('multipart/form-data')) {
      // File upload path
      const part = await request.file();
      if (!part) throw validation('missing file in multipart form');

      let content: Buffer;
      try {
        content = await part.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new AppError('PAYLOAD_TOO_LARGE', 'file exceeds the ingest size limit', {
            details: { limitBytes: INGEST_MAX_FILE_BYTES },
          });
        }
        throw err;
      }

      const mime = part.mimetype;
      const filename = part.filename || 'untitled';

      // Save to attachment store so the original is preserved (F762)
      const hash = sha256Hex(content);
      saveAttachmentFile(app.dataDir, hash, content);
      const attachment = attachmentsRepo(app.db).create({
        noteId: null,
        filename,
        mime,
        size: content.byteLength,
        hash,
      });

      // Dispatch to appropriate extractor
      if (mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
        const job = startPdfIngest(app.db, app.intel, unavailableOcrProvider, {
          buffer: content,
          filename,
          attachmentId: attachment.id,
        });
        reply.status(202);
        return { data: job };
      }

      if (
        mime === 'application/epub+zip' ||
        mime === 'application/epub' ||
        filename.toLowerCase().endsWith('.epub')
      ) {
        const job = startEpubIngest(app.db, app.intel, {
          buffer: content,
          filename,
          attachmentId: attachment.id,
        });
        reply.status(202);
        return { data: job };
      }

      if (mime.startsWith('text/html') || filename.toLowerCase().endsWith('.html')) {
        const html = content.toString('utf8');
        const job = startHtmlIngest(app.db, app.intel, {
          html,
          sourceUrl: `file://${filename}`,
        });
        reply.status(202);
        return { data: job };
      }

      throw validation(
        `unsupported file type "${mime}" — supported: PDF, EPUB, HTML`,
        { mime, filename },
      );
    }

    // JSON body path — URL ingestion
    const body = parseWith(urlBodySchema, request.body, 'body');
    const job = startUrlIngest(app.db, app.intel, {
      url: body.url,
      ...(body.selection !== undefined ? { selection: body.selection } : {}),
      ...(body.notebookId !== undefined ? { notebookId: body.notebookId as NotebookId } : {}),
    });
    reply.status(202);
    return { data: job };
  });

  /** GET /ingest/jobs — list jobs newest first (F766) */
  app.get('/ingest/jobs', async (request) => {
    const pagination = parsePagination(request.query);
    const rows = ingestJobsRepo(app.db).list({
      limit: pagination.limit + 1,
      cursor: pagination.cursor,
    });
    return paginated(rows, pagination);
  });

  /** GET /ingest/jobs/:id */
  app.get('/ingest/jobs/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const job = ingestJobsRepo(app.db).get(id);
    if (!job) throw notFound('IngestJob', id);
    return { data: job };
  });
};
