/**
 * Webhook & integrations delivery core (Epic 20, F1931–F1938).
 *
 * Pure logic module — no DB, no filesystem access. Network I/O is performed
 * exclusively through an injected FetchLike so every path is testable with
 * zero real network calls.
 *
 * Exports:
 *   F1931 buildPayload        — construct a typed outbound webhook payload
 *   F1933 renderTemplate      — {{ dotted.path }} + {{json key}} interpolation
 *   F1932 verifyInboundToken  — constant-time token comparison
 *   F1932 signPayload         — HMAC-SHA256 hex signature of a request body
 *   F1932/F1938 verifySignature — verify an inbound HMAC signature
 *   F1934 nextRetry           — exponential-backoff retry decision
 *   F1934 classifyResponse    — map HTTP status → ok / retry / dead
 *   F1937 buildFeed           — RSS 2.0 XML from FeedItem[]
 *         deliver             — POST a payload via injected fetch, returns DeliveryResult
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// FetchLike — the only network abstraction allowed in this module
// ---------------------------------------------------------------------------

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

// ---------------------------------------------------------------------------
// F1931 — Outbound webhook payloads
// ---------------------------------------------------------------------------

export type WebhookEventType =
  | 'note.created'
  | 'note.updated'
  | 'note.deleted'
  | 'note.tagged'
  | 'note.untagged'
  | 'notebook.created'
  | 'notebook.updated'
  | 'notebook.deleted'
  | 'custom';

export interface WebhookEvent {
  type: WebhookEventType;
  noteId?: string | undefined;
  notebookId?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface WebhookPayload {
  /** Fables-specific MIME type hint for receivers. */
  contentType: 'application/json';
  body: string;
  /** Parsed representation for convenience (the body IS this JSON-stringified). */
  json: {
    event: WebhookEventType;
    noteId?: string | undefined;
    notebookId?: string | undefined;
    data?: Record<string, unknown> | undefined;
    timestamp: string;
  };
}

/**
 * Build a JSON webhook payload from an event, optionally rendering the body
 * through a payload template (F1933 integration point).
 */
export function buildPayload(event: WebhookEvent, template?: string | undefined): WebhookPayload {
  const timestamp = new Date().toISOString();

  const json: WebhookPayload['json'] = {
    event: event.type,
    timestamp,
    ...(event.noteId !== undefined ? { noteId: event.noteId } : {}),
    ...(event.notebookId !== undefined ? { notebookId: event.notebookId } : {}),
    ...(event.data !== undefined ? { data: event.data } : {}),
  };

  const context: Record<string, unknown> = {
    event: event.type,
    noteId: event.noteId ?? '',
    notebookId: event.notebookId ?? '',
    timestamp,
    data: event.data ?? {},
  };

  const body = template !== undefined ? renderTemplate(template, context) : JSON.stringify(json);

  return { contentType: 'application/json', body, json };
}

// ---------------------------------------------------------------------------
// F1933 — Payload templates
// ---------------------------------------------------------------------------

/**
 * Tiny template engine. Supports:
 *   {{ dotted.path }}   — resolved from context, coerced to string; missing → ""
 *   {{json key}}        — JSON.stringify of the resolved value (no HTML escaping)
 *
 * No loops, no conditionals, no HTML-safe-by-default — values are raw.
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  // Handle {{json key}} first (before plain {{ }})
  let result = template.replace(/\{\{json\s+([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const val = resolvePath(context, path);
    return JSON.stringify(val ?? null);
  });

  // Handle {{ dotted.path }}
  result = result.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const val = resolvePath(context, path);
    if (val === undefined || val === null) return '';
    return String(val);
  });

  return result;
}

/** Walk a dotted path through a nested object; returns undefined for missing keys. */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ---------------------------------------------------------------------------
// F1932 — Inbound webhook auth + F1938 — outbound signing
// ---------------------------------------------------------------------------

/**
 * Constant-time token comparison via `timingSafeEqual`. Returns false when the
 * strings differ in length (early-exit before allocation) to prevent timing
 * attacks while still being correct.
 */
export function verifyInboundToken(provided: string, expected: string): boolean {
  // Length check is not secret — comparing lengths is safe.
  if (provided.length !== expected.length) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // Lengths are guaranteed equal; timingSafeEqual requires equal-length buffers.
  return timingSafeEqual(a, b);
}

/**
 * Sign a request body with HMAC-SHA256, returning the hex digest.
 * Receivers verify this with `verifySignature`.
 */
export function signPayload(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/**
 * Verify that the provided hex signature matches `signPayload(body, secret)`.
 * Comparison is constant-time.
 */
export function verifySignature(body: string, secret: string, signature: string): boolean {
  const expected = signPayload(body, secret);
  // Both hex strings are always the same length (64 hex chars for SHA-256).
  return verifyInboundToken(signature, expected);
}

// ---------------------------------------------------------------------------
// F1934 — Delivery retries + dead-letter queue logic
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 5. */
  maxAttempts?: number | undefined;
  /** Base delay in ms. Default: 1000. */
  baseDelayMs?: number | undefined;
  /** Maximum delay cap in ms. Default: 60_000. */
  maxDelayMs?: number | undefined;
}

export type RetryDecision = { retry: true; delayMs: number } | { retry: false };

/**
 * Compute the next retry decision for a given attempt number (0-based).
 *
 * Uses deterministic exponential backoff: `baseDelayMs * 2^attempt`, capped at
 * `maxDelayMs`. When `attempt >= maxAttempts - 1` the delivery is dead-lettered.
 */
export function nextRetry(attempt: number, opts?: RetryOptions | undefined): RetryDecision {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  const maxDelayMs = opts?.maxDelayMs ?? 60_000;

  // `attempt` is 0-based: attempt 0 = first failure, attempt 4 = 5th failure
  if (attempt >= maxAttempts - 1) {
    return { retry: false };
  }

  const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  return { retry: true, delayMs };
}

/**
 * Classify an HTTP response status for retry logic.
 *   2xx        → 'ok'
 *   408/429/5xx → 'retry'
 *   other 4xx  → 'dead'
 */
export function classifyResponse(status: number): 'ok' | 'retry' | 'dead' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 408 || status === 429 || (status >= 500 && status < 600)) return 'retry';
  return 'dead';
}

// ---------------------------------------------------------------------------
// F1937 — RSS 2.0 feed builder
// ---------------------------------------------------------------------------

export interface FeedItem {
  title: string;
  link: string;
  guid: string;
  pubDate: Date;
  description: string;
}

export interface FeedMeta {
  title: string;
  link: string;
  description: string;
  /** Optional RFC-2822-style last-build date; defaults to now. */
  lastBuildDate?: Date | undefined;
  /** Optional language tag, e.g. "en-us". */
  language?: string | undefined;
}

/** Escape text for safe embedding in XML character data. */
function xmlEscape(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Format a Date as RFC-2822 (suitable for RSS pubDate / lastBuildDate). */
function rfc2822(date: Date): string {
  // toUTCString() produces RFC-7231/RFC-1123, which is compatible with RSS.
  return date.toUTCString();
}

/**
 * Build a valid RSS 2.0 XML document from an array of items and channel meta.
 * All text fields are XML-escaped.
 */
export function buildFeed(items: FeedItem[], meta: FeedMeta): string {
  const lastBuild = meta.lastBuildDate ?? new Date();

  const channelMeta = [
    `    <title>${xmlEscape(meta.title)}</title>`,
    `    <link>${xmlEscape(meta.link)}</link>`,
    `    <description>${xmlEscape(meta.description)}</description>`,
    `    <lastBuildDate>${xmlEscape(rfc2822(lastBuild))}</lastBuildDate>`,
    ...(meta.language !== undefined
      ? [`    <language>${xmlEscape(meta.language)}</language>`]
      : []),
  ].join('\n');

  const itemsXml = items
    .map((item) =>
      [
        '    <item>',
        `      <title>${xmlEscape(item.title)}</title>`,
        `      <link>${xmlEscape(item.link)}</link>`,
        `      <guid>${xmlEscape(item.guid)}</guid>`,
        `      <pubDate>${xmlEscape(rfc2822(item.pubDate))}</pubDate>`,
        `      <description>${xmlEscape(item.description)}</description>`,
        '    </item>',
      ].join('\n'),
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    channelMeta,
    itemsXml,
    '  </channel>',
    '</rss>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Delivery function — POST via injected fetch
// ---------------------------------------------------------------------------

export interface DeliveryTarget {
  url: string;
}

export interface DeliveryOptions {
  fetch: FetchLike;
  /** When set, the payload body is signed and the signature sent as X-Fables-Signature. */
  secret?: string | undefined;
}

export interface DeliveryResult {
  status: number;
  outcome: 'ok' | 'retry' | 'dead';
  body?: string | undefined;
}

/**
 * POST a WebhookPayload to a target URL via an injected fetch.
 *
 * - Never throws on non-2xx HTTP responses — those are captured in DeliveryResult.
 * - Throws only on network-level errors (fetch itself rejects).
 * - Signs the payload body with HMAC-SHA256 when `opts.secret` is provided.
 */
export async function deliver(
  target: DeliveryTarget,
  payload: WebhookPayload,
  opts: DeliveryOptions,
): Promise<DeliveryResult> {
  const headers: Record<string, string> = {
    'Content-Type': payload.contentType,
    'X-Fables-Event': payload.json.event,
  };

  if (opts.secret !== undefined) {
    const sig = signPayload(payload.body, opts.secret);
    headers['X-Fables-Signature'] = `sha256=${sig}`;
  }

  const res = await opts.fetch(target.url, {
    method: 'POST',
    headers,
    body: payload.body,
  });

  const outcome = classifyResponse(res.status);
  let body: string | undefined;
  try {
    body = await res.text();
  } catch {
    // body unreadable — not fatal
    body = undefined;
  }

  return {
    status: res.status,
    outcome,
    ...(body !== undefined ? { body } : {}),
  };
}
