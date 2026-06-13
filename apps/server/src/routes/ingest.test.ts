/**
 * Tests for F761–F770: document ingestion routes.
 *
 * Tests with small in-memory fixtures to avoid disk I/O.
 * pdfjs-dist is not available in test env (dynamic import fails gracefully).
 * EPUB and HTML extraction are fully tested since they have no native deps.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { extractEpub, EPUB_MAX_BYTES } from '../ingest/epub-extractor.js';
import { extractHtml } from '../ingest/html-extractor.js';
import { makeMinimalEpub, FIXTURE_HTML } from './__fixtures__/make-fixtures.js';

let app: FastifyInstance;
let dataDir: string;

const BOUNDARY = 'ingest-test-boundary';

function multipartPayload(
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

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-ingest-'));
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal', DATA_DIR: dataDir }));
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ── Unit tests for extractors (no HTTP, no pdfjs) ────────────────────────────

describe('EPUB extractor (F764)', () => {
  it('extracts chapters from a minimal EPUB', () => {
    const epub = makeMinimalEpub();
    const result = extractEpub(epub, 'test.epub');
    expect(result.bookTitle).toBe('Test Book');
    expect(result.author).toBe('Test Author');
    expect(result.chapters.length).toBeGreaterThan(0);
    const ch = result.chapters[0]!;
    expect(ch.text).toContain('first chapter');
  });

  it('throws on invalid (non-zip) EPUB', () => {
    expect(() => extractEpub(Buffer.from('not a zip'), 'bad.epub')).toThrow();
  });

  it('exports the correct EPUB_MAX_BYTES constant (F769)', () => {
    expect(EPUB_MAX_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe('HTML extractor (F765, F771)', () => {
  it('extracts article content via Readability', async () => {
    const result = await extractHtml(FIXTURE_HTML, 'https://example.com/article');
    expect(result.title).toBe('Test Article');
    expect(result.markdownBody).toBeTruthy();
    expect(result.metadata.sourceUrl).toBe('https://example.com/article');
    expect(result.metadata.siteName).toBeTruthy();
    expect(result.metadata.clippedAt).toBeTruthy();
  });

  it('preserves image URLs (F775)', async () => {
    const result = await extractHtml(FIXTURE_HTML, 'https://example.com/article');
    expect(result.imageUrls).toContain('https://example.com/image.jpg');
  });

  it('wraps selection as quote block (F774)', async () => {
    const result = await extractHtml(FIXTURE_HTML, 'https://example.com/article', 'selected text here');
    expect(result.markdownBody).toContain('> selected text here');
    expect(result.markdownBody).toContain('https://example.com/article');
  });

  it('falls back gracefully on empty/JS-only HTML (F779)', async () => {
    const minimalHtml = '<html><head><title>Empty</title></head><body></body></html>';
    const result = await extractHtml(minimalHtml, 'https://example.com/empty');
    // Should not throw — readabilitySucceeded may be false but result is valid
    expect(result.metadata.sourceUrl).toBe('https://example.com/empty');
  });
});

// ── HTTP route tests ─────────────────────────────────────────────────────────

describe('POST /ingest — EPUB (F764)', () => {
  it('accepts an EPUB upload and returns a queued job (202)', async () => {
    const epub = makeMinimalEpub();
    const { payload, headers } = multipartPayload('book.epub', 'application/epub+zip', epub);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest',
      payload,
      headers,
    });
    expect(res.statusCode).toBe(202);
    const job = res.json().data;
    expect(job.id).toBeTruthy();
    expect(job.sourceType).toBe('epub');
    expect(job.sourceName).toBe('book.epub');
    // status is 'queued' or 'running' (async, may have already completed)
    expect(['queued', 'running', 'done', 'failed']).toContain(job.status);
  });
});

describe('POST /ingest — HTML file (F765)', () => {
  it('accepts an HTML upload and returns a queued job', async () => {
    const html = Buffer.from(FIXTURE_HTML);
    const { payload, headers } = multipartPayload('page.html', 'text/html', html);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest',
      payload,
      headers,
    });
    expect(res.statusCode).toBe(202);
    const job = res.json().data;
    expect(job.sourceType).toBe('html');
  });
});

describe('POST /ingest — URL (F765)', () => {
  it('rejects invalid URLs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest',
      payload: { url: 'not-a-url' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('POST /ingest — unsupported type (F765)', () => {
  it('rejects unsupported MIME types', async () => {
    const { payload, headers } = multipartPayload(
      'evil.zip',
      'application/zip',
      Buffer.from('not a pdf'),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest',
      payload,
      headers,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('unsupported file type');
  });
});

describe('GET /ingest/jobs (F766)', () => {
  it('returns a list of jobs with pagination', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ingest/jobs' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.page).toBeDefined();
  });
});

describe('GET /ingest/jobs/:id', () => {
  it('404s for unknown job id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ingest/jobs/ingest_nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('returns a known job by id', async () => {
    // First create a job
    const epub = makeMinimalEpub();
    const { payload, headers } = multipartPayload('lookup.epub', 'application/epub+zip', epub);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest',
      payload,
      headers,
    });
    const job = created.json().data;

    const res = await app.inject({ method: 'GET', url: `/api/v1/ingest/jobs/${job.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(job.id);
  });
});
