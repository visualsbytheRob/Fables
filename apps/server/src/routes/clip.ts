/**
 * Web clipper routes (F771–F779).
 *
 * POST /clip   — clip a URL or raw HTML → Readability → note in Clip Inbox
 * GET  /clip/duplicate-check?url=... — check if a URL has already been clipped (F777)
 *
 * Features:
 *   F771: POST /clip {url, selection?} → note
 *   F774: selection → quote block in note body
 *   F775: image URLs preserved as metadata (image download deferred to client)
 *   F776: clip metadata: source URL, site name, byline, clipped-at, favicon
 *   F777: duplicate detection by URL → returns existing job if found
 *   F778: Clip Inbox notebook auto-created
 *   F779: paywall/JS-only fallback → raw-text fallback mode
 *
 * Skipped (web-only):
 *   F772: bookmarklet generator page (web route)
 *   F773: iOS share target (web manifest)
 */

import { notFound, validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { ingestJobsRepo } from '../db/repos/ingest-jobs.js';
import { ensureClipInbox, startHtmlIngest, startUrlIngest } from '../ingest/ingest-service.js';
import type { NotebookId } from '@fables/core';

const clipBodySchema = z.object({
  /** URL to clip (will be fetched). Mutually exclusive with `html`. */
  url: z.string().url().optional(),
  /** Raw HTML to clip (pre-fetched by bookmarklet). Mutually exclusive with `url`. */
  html: z.string().optional(),
  /** Source URL when `html` is provided (for metadata). */
  sourceUrl: z.string().optional(),
  /** Optional text selection — becomes a quote block in the note (F774). */
  selection: z.string().optional(),
  /** Target notebook — defaults to Clip Inbox (F778). */
  notebookId: z.string().min(1).optional(),
}).refine((d) => d.url || d.html, {
  message: 'either "url" or "html" is required',
});

const duplicateCheckSchema = z.object({
  url: z.string().url(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

registerRoute({
  method: 'POST',
  path: '/clip',
  summary: 'Clip a URL or raw HTML → Readability → note (F771)',
  body: clipBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/clip/duplicate-check',
  summary: 'Check if a URL has already been clipped (F777)',
  query: duplicateCheckSchema,
});
registerRoute({
  method: 'GET',
  path: '/clip/jobs/:id',
  summary: 'Fetch a clip job by ID',
  params: idParamsSchema,
});

export const clipRoutes: FastifyPluginAsync = async (app) => {
  /** POST /clip */
  app.post('/clip', async (request, reply) => {
    const body = parseWith(clipBodySchema, request.body, 'body');
    const notebookId = (body.notebookId as NotebookId | undefined) ?? ensureClipInbox(app.db);

    if (body.url) {
      // Duplicate check (F777): if same URL already clipped and succeeded, return existing job
      const existing = ingestJobsRepo(app.db).findBySourceUrl(body.url);
      if (existing) {
        return { data: existing, duplicate: true };
      }

      const job = startUrlIngest(app.db, app.intel, {
        url: body.url,
        ...(body.selection !== undefined ? { selection: body.selection } : {}),
        notebookId,
      });
      reply.status(202);
      return { data: job, duplicate: false };
    }

    // Raw HTML path (sent by bookmarklet)
    if (!body.html) throw validation('either "url" or "html" is required');
    const sourceUrl = body.sourceUrl || 'about:blank';

    // Duplicate check for HTML with known source URL
    if (body.sourceUrl) {
      const existing = ingestJobsRepo(app.db).findBySourceUrl(body.sourceUrl);
      if (existing) {
        return { data: existing, duplicate: true };
      }
    }

    const job = startHtmlIngest(app.db, app.intel, {
      html: body.html,
      sourceUrl,
      ...(body.selection !== undefined ? { selection: body.selection } : {}),
      notebookId,
    });
    reply.status(202);
    return { data: job, duplicate: false };
  });

  /** GET /clip/duplicate-check?url=... (F777) */
  app.get('/clip/duplicate-check', async (request) => {
    const { url } = parseWith(duplicateCheckSchema, request.query, 'query');
    const existing = ingestJobsRepo(app.db).findBySourceUrl(url);
    return {
      data: {
        url,
        isDuplicate: existing !== null,
        existingJob: existing,
      },
    };
  });

  /** GET /clip/jobs/:id */
  app.get('/clip/jobs/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const job = ingestJobsRepo(app.db).get(id);
    if (!job) throw notFound('ClipJob', id);
    return { data: job };
  });
};
