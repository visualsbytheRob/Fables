/**
 * Webhook delivery tests (Epic 20, F1931–F1938).
 *
 * Covers: buildPayload, renderTemplate, verifyInboundToken, signPayload,
 * verifySignature, nextRetry, classifyResponse, buildFeed, deliver.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildPayload,
  renderTemplate,
  verifyInboundToken,
  signPayload,
  verifySignature,
  nextRetry,
  classifyResponse,
  buildFeed,
  deliver,
} from './delivery.js';
import type { FetchLike, FeedItem, FeedMeta, WebhookEvent, DeliveryTarget } from './delivery.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(status: number, body = ''): FetchLike {
  return vi.fn().mockResolvedValue({
    status,
    text: async () => body,
  });
}

const baseEvent: WebhookEvent = {
  type: 'note.created',
  noteId: 'note-123',
  data: { title: 'Hello' },
};

// ---------------------------------------------------------------------------
// F1931 — buildPayload
// ---------------------------------------------------------------------------

describe('buildPayload (F1931)', () => {
  it('returns correct contentType', () => {
    const p = buildPayload(baseEvent);
    expect(p.contentType).toBe('application/json');
  });

  it('body is valid JSON round-trippable through json field', () => {
    const p = buildPayload(baseEvent);
    const parsed = JSON.parse(p.body) as typeof p.json;
    expect(parsed.event).toBe('note.created');
    expect(parsed.noteId).toBe('note-123');
    expect(parsed.timestamp).toBe(p.json.timestamp);
  });

  it('includes noteId when present', () => {
    const p = buildPayload({ type: 'note.updated', noteId: 'abc' });
    expect(p.json.noteId).toBe('abc');
    expect(JSON.parse(p.body) as Record<string, unknown>).toMatchObject({ noteId: 'abc' });
  });

  it('omits noteId when not provided', () => {
    const p = buildPayload({ type: 'notebook.created', notebookId: 'nb-1' });
    expect(p.json.noteId).toBeUndefined();
    expect(JSON.parse(p.body) as Record<string, unknown>).not.toHaveProperty('noteId');
  });

  it('includes notebookId when present', () => {
    const p = buildPayload({ type: 'notebook.created', notebookId: 'nb-99' });
    expect(p.json.notebookId).toBe('nb-99');
  });

  it('includes data when provided', () => {
    const p = buildPayload({ type: 'custom', data: { x: 1 } });
    expect(p.json.data).toEqual({ x: 1 });
  });

  it('timestamp is a valid ISO 8601 string', () => {
    const p = buildPayload(baseEvent);
    expect(new Date(p.json.timestamp).toISOString()).toBe(p.json.timestamp);
  });

  it('applies a template when provided', () => {
    const tmpl = '{"evt":"{{ event }}","id":"{{ noteId }}"}';
    const p = buildPayload(baseEvent, tmpl);
    expect(p.body).toBe('{"evt":"note.created","id":"note-123"}');
  });

  it('template body does not equal default JSON body', () => {
    const tmpl = 'event={{ event }}';
    const p = buildPayload(baseEvent, tmpl);
    expect(p.body).toBe('event=note.created');
  });

  it('handles all WebhookEventType values without throwing', () => {
    const types: WebhookEvent['type'][] = [
      'note.created',
      'note.updated',
      'note.deleted',
      'note.tagged',
      'note.untagged',
      'notebook.created',
      'notebook.updated',
      'notebook.deleted',
      'custom',
    ];
    for (const type of types) {
      expect(() => buildPayload({ type })).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// F1933 — renderTemplate
// ---------------------------------------------------------------------------

describe('renderTemplate (F1933)', () => {
  it('interpolates a top-level key', () => {
    expect(renderTemplate('Hello {{ name }}', { name: 'World' })).toBe('Hello World');
  });

  it('resolves dotted paths', () => {
    expect(renderTemplate('{{ a.b.c }}', { a: { b: { c: 42 } } })).toBe('42');
  });

  it('missing key → empty string', () => {
    expect(renderTemplate('x={{ missing }}', {})).toBe('x=');
  });

  it('nested missing key → empty string', () => {
    expect(renderTemplate('{{ a.b }}', { a: {} })).toBe('');
  });

  it('{{json key}} produces JSON-stringified value', () => {
    expect(renderTemplate('{{json val}}', { val: { x: 1 } })).toBe('{"x":1}');
  });

  it('{{json key}} for null-equivalent missing → null', () => {
    expect(renderTemplate('{{json missing}}', {})).toBe('null');
  });

  it('{{json key}} for an array', () => {
    expect(renderTemplate('{{json arr}}', { arr: [1, 2, 3] })).toBe('[1,2,3]');
  });

  it('{{json key}} for a string', () => {
    expect(renderTemplate('{{json s}}', { s: 'hello' })).toBe('"hello"');
  });

  it('handles multiple placeholders in one template', () => {
    const result = renderTemplate('{{ a }} + {{ b }} = {{ c }}', { a: 1, b: 2, c: 3 });
    expect(result).toBe('1 + 2 = 3');
  });

  it('leaves unmatched text untouched', () => {
    expect(renderTemplate('no placeholders here', {})).toBe('no placeholders here');
  });

  it('values are raw (no HTML escaping)', () => {
    expect(renderTemplate('{{ html }}', { html: '<b>&amp;</b>' })).toBe('<b>&amp;</b>');
  });

  it('numeric values coerce to string', () => {
    expect(renderTemplate('{{ n }}', { n: 99 })).toBe('99');
  });

  it('boolean values coerce to string', () => {
    expect(renderTemplate('{{ flag }}', { flag: true })).toBe('true');
  });

  it('null value → empty string', () => {
    expect(renderTemplate('{{ k }}', { k: null })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// F1932 — verifyInboundToken
// ---------------------------------------------------------------------------

describe('verifyInboundToken (F1932)', () => {
  it('returns true for equal tokens', () => {
    expect(verifyInboundToken('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different tokens of same length', () => {
    expect(verifyInboundToken('abc123', 'xyz789')).toBe(false);
  });

  it('returns false when lengths differ', () => {
    expect(verifyInboundToken('short', 'longertoken')).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(verifyInboundToken('', 'a')).toBe(false);
  });

  it('returns true for both empty', () => {
    expect(verifyInboundToken('', '')).toBe(true);
  });

  it('is case-sensitive', () => {
    expect(verifyInboundToken('Token', 'token')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F1932 / F1938 — signPayload + verifySignature
// ---------------------------------------------------------------------------

describe('signPayload + verifySignature (F1932/F1938)', () => {
  const secret = 'my-secret-key';
  const body = '{"event":"note.created"}';

  it('signPayload returns a 64-char hex string (SHA-256)', () => {
    const sig = signPayload(body, secret);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signPayload is deterministic', () => {
    expect(signPayload(body, secret)).toBe(signPayload(body, secret));
  });

  it('different secret → different signature', () => {
    expect(signPayload(body, 'secret-a')).not.toBe(signPayload(body, 'secret-b'));
  });

  it('different body → different signature', () => {
    expect(signPayload('body-a', secret)).not.toBe(signPayload('body-b', secret));
  });

  it('verifySignature returns true for correct signature', () => {
    const sig = signPayload(body, secret);
    expect(verifySignature(body, secret, sig)).toBe(true);
  });

  it('verifySignature returns false for wrong signature', () => {
    expect(verifySignature(body, secret, 'a'.repeat(64))).toBe(false);
  });

  it('verifySignature returns false when body is tampered', () => {
    const sig = signPayload(body, secret);
    expect(verifySignature('tampered', secret, sig)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F1934 — nextRetry
// ---------------------------------------------------------------------------

describe('nextRetry (F1934)', () => {
  it('returns retry:true with delayMs for attempt 0', () => {
    const r = nextRetry(0);
    expect(r.retry).toBe(true);
    if (r.retry) expect(r.delayMs).toBe(1000);
  });

  it('doubles delay on each attempt', () => {
    const r0 = nextRetry(0);
    const r1 = nextRetry(1);
    expect(r0.retry && r1.retry && r1.delayMs === r0.delayMs * 2).toBe(true);
  });

  it('caps delay at maxDelayMs', () => {
    // Use attempt 3 (within 5-attempt default) to confirm the cap is applied
    const r = nextRetry(3, { baseDelayMs: 1000, maxDelayMs: 5_000 });
    expect(r.retry).toBe(true);
    if (r.retry) expect(r.delayMs).toBeLessThanOrEqual(5_000);
  });

  it('dead-letters after maxAttempts - 1 (default 5)', () => {
    const r = nextRetry(4);
    expect(r.retry).toBe(false);
  });

  it('custom maxAttempts: dead-letters at correct threshold', () => {
    expect(nextRetry(2, { maxAttempts: 3 }).retry).toBe(false);
    expect(nextRetry(1, { maxAttempts: 3 }).retry).toBe(true);
  });

  it('respects custom baseDelayMs', () => {
    const r = nextRetry(0, { baseDelayMs: 500, maxAttempts: 5 });
    expect(r.retry && r.delayMs).toBe(500);
  });

  it('attempt 2 delay = base * 4', () => {
    const r = nextRetry(2, { baseDelayMs: 100, maxAttempts: 10 });
    expect(r.retry && r.delayMs).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// F1934 — classifyResponse
// ---------------------------------------------------------------------------

describe('classifyResponse (F1934)', () => {
  it('200 → ok', () => expect(classifyResponse(200)).toBe('ok'));
  it('201 → ok', () => expect(classifyResponse(201)).toBe('ok'));
  it('299 → ok', () => expect(classifyResponse(299)).toBe('ok'));
  it('408 → retry', () => expect(classifyResponse(408)).toBe('retry'));
  it('429 → retry', () => expect(classifyResponse(429)).toBe('retry'));
  it('500 → retry', () => expect(classifyResponse(500)).toBe('retry'));
  it('503 → retry', () => expect(classifyResponse(503)).toBe('retry'));
  it('599 → retry', () => expect(classifyResponse(599)).toBe('retry'));
  it('400 → dead', () => expect(classifyResponse(400)).toBe('dead'));
  it('401 → dead', () => expect(classifyResponse(401)).toBe('dead'));
  it('403 → dead', () => expect(classifyResponse(403)).toBe('dead'));
  it('404 → dead', () => expect(classifyResponse(404)).toBe('dead'));
  it('410 → dead', () => expect(classifyResponse(410)).toBe('dead'));
  it('422 → dead', () => expect(classifyResponse(422)).toBe('dead'));
});

// ---------------------------------------------------------------------------
// F1937 — buildFeed (RSS 2.0)
// ---------------------------------------------------------------------------

describe('buildFeed (F1937)', () => {
  const meta: FeedMeta = {
    title: 'My Stories',
    link: 'https://fables.local',
    description: 'A feed of my notes',
    language: 'en-us',
  };

  const items: FeedItem[] = [
    {
      title: 'First Note',
      link: 'https://fables.local/notes/1',
      guid: 'note-1',
      pubDate: new Date('2024-01-01T00:00:00Z'),
      description: 'The beginning.',
    },
    {
      title: 'Second Note',
      link: 'https://fables.local/notes/2',
      guid: 'note-2',
      pubDate: new Date('2024-01-02T00:00:00Z'),
      description: 'The sequel.',
    },
  ];

  it('produces valid XML declaration', () => {
    const feed = buildFeed(items, meta);
    expect(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it('wraps content in <rss version="2.0"> and <channel>', () => {
    const feed = buildFeed(items, meta);
    expect(feed).toContain('<rss version="2.0">');
    expect(feed).toContain('<channel>');
    expect(feed).toContain('</channel>');
    expect(feed).toContain('</rss>');
  });

  it('includes channel title, link, description', () => {
    const feed = buildFeed(items, meta);
    expect(feed).toContain('<title>My Stories</title>');
    expect(feed).toContain('<link>https://fables.local</link>');
    expect(feed).toContain('<description>A feed of my notes</description>');
  });

  it('includes language when provided', () => {
    const feed = buildFeed(items, meta);
    expect(feed).toContain('<language>en-us</language>');
  });

  it('omits language when not provided', () => {
    const feed = buildFeed(items, { ...meta, language: undefined });
    expect(feed).not.toContain('<language>');
  });

  it('includes item titles and links', () => {
    const feed = buildFeed(items, meta);
    expect(feed).toContain('<title>First Note</title>');
    expect(feed).toContain('<link>https://fables.local/notes/1</link>');
  });

  it('includes item guid', () => {
    const feed = buildFeed(items, meta);
    expect(feed).toContain('<guid>note-1</guid>');
    expect(feed).toContain('<guid>note-2</guid>');
  });

  it('includes item pubDate', () => {
    const feed = buildFeed(items, meta);
    expect(feed).toContain('<pubDate>');
  });

  it('XML-escapes & in title', () => {
    const feed = buildFeed([{ ...items[0]!, title: 'Cats & Dogs' }], meta);
    expect(feed).toContain('Cats &amp; Dogs');
    expect(feed).not.toContain('Cats & Dogs');
  });

  it('XML-escapes < and > in description', () => {
    const feed = buildFeed([{ ...items[0]!, description: '<script>alert(1)</script>' }], meta);
    expect(feed).toContain('&lt;script&gt;');
    expect(feed).not.toContain('<script>alert');
  });

  it('XML-escapes " in description', () => {
    const feed = buildFeed([{ ...items[0]!, description: 'She said "hello"' }], meta);
    expect(feed).toContain('&quot;');
  });

  it("XML-escapes ' in description", () => {
    const feed = buildFeed([{ ...items[0]!, description: "it's fine" }], meta);
    expect(feed).toContain('&apos;');
  });

  it('XML-escapes & in channel title', () => {
    const feed = buildFeed(items, { ...meta, title: 'A & B' });
    expect(feed).toContain('A &amp; B');
  });

  it('handles an empty items array', () => {
    const feed = buildFeed([], meta);
    expect(feed).toContain('<channel>');
    expect(feed).not.toContain('<item>');
  });

  it('includes all items', () => {
    const feed = buildFeed(items, meta);
    const itemCount = (feed.match(/<item>/g) ?? []).length;
    expect(itemCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// deliver — integration of all pieces
// ---------------------------------------------------------------------------

describe('deliver', () => {
  const target: DeliveryTarget = { url: 'https://hooks.example.com/webhook' };
  const payload = buildPayload(baseEvent);

  it('calls fetch with correct URL and method', async () => {
    const mockFetch = makeFetch(200, 'ok');
    await deliver(target, payload, { fetch: mockFetch });
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe(target.url);
    expect(init.method).toBe('POST');
  });

  it('sets Content-Type header to application/json', async () => {
    const mockFetch = makeFetch(200);
    await deliver(target, payload, { fetch: mockFetch });
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sets X-Fables-Event header', async () => {
    const mockFetch = makeFetch(200);
    await deliver(target, payload, { fetch: mockFetch });
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(init.headers['X-Fables-Event']).toBe('note.created');
  });

  it('returns outcome ok for 200', async () => {
    const result = await deliver(target, payload, { fetch: makeFetch(200, 'ok') });
    expect(result.outcome).toBe('ok');
    expect(result.status).toBe(200);
  });

  it('returns outcome retry for 429', async () => {
    const result = await deliver(target, payload, { fetch: makeFetch(429) });
    expect(result.outcome).toBe('retry');
  });

  it('returns outcome retry for 500', async () => {
    const result = await deliver(target, payload, { fetch: makeFetch(500) });
    expect(result.outcome).toBe('retry');
  });

  it('returns outcome dead for 400', async () => {
    const result = await deliver(target, payload, { fetch: makeFetch(400) });
    expect(result.outcome).toBe('dead');
  });

  it('returns outcome dead for 404', async () => {
    const result = await deliver(target, payload, { fetch: makeFetch(404) });
    expect(result.outcome).toBe('dead');
  });

  it('does not throw on non-2xx — returns structured result', async () => {
    await expect(deliver(target, payload, { fetch: makeFetch(503) })).resolves.toMatchObject({
      status: 503,
      outcome: 'retry',
    });
  });

  it('includes body in result', async () => {
    const result = await deliver(target, payload, { fetch: makeFetch(200, 'received') });
    expect(result.body).toBe('received');
  });

  it('adds X-Fables-Signature header when secret is provided', async () => {
    const secret = 'webhook-secret';
    const mockFetch = makeFetch(200);
    await deliver(target, payload, { fetch: mockFetch, secret });
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    const sigHeader = init.headers['X-Fables-Signature'];
    expect(sigHeader).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('signature header is verifiable', async () => {
    const secret = 'webhook-secret';
    const mockFetch = makeFetch(200);
    await deliver(target, payload, { fetch: mockFetch, secret });
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    const sigHeader = init.headers['X-Fables-Signature'] ?? '';
    const hexSig = sigHeader.replace('sha256=', '');
    expect(verifySignature(payload.body, secret, hexSig)).toBe(true);
  });

  it('omits X-Fables-Signature when no secret', async () => {
    const mockFetch = makeFetch(200);
    await deliver(target, payload, { fetch: mockFetch });
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(init.headers['X-Fables-Signature']).toBeUndefined();
  });

  it('propagates network errors (fetch rejects)', async () => {
    const brokenFetch: FetchLike = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(deliver(target, payload, { fetch: brokenFetch })).rejects.toThrow('ECONNREFUSED');
  });
});
