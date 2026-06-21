/**
 * Claude cloud adapter tests (F1370) — every path exercised with a mocked HTTP
 * client, ZERO real network calls. Covers availability gating on the API key
 * (F1362), one-shot generation + token accounting, retry/backoff on 429/5xx
 * (F1366), non-retryable failures, and SSE streaming.
 */

import { describe, expect, it, vi } from 'vitest';
import { ClaudeAdapter, CLAUDE_MODELS, looksLikeApiKey, type FetchLike } from './claude.js';

const KEY = 'sk-ant-test-0123456789';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

const messagesBody = (text: string) => ({
  content: [{ type: 'text', text }],
  model: 'claude-opus-4-8',
  usage: { input_tokens: 11, output_tokens: 7 },
});

describe('availability + models (F1362)', () => {
  it('is unavailable without an API key and exposes no models', async () => {
    const a = new ClaudeAdapter({ apiKey: '' });
    expect(await a.isAvailable()).toBe(false);
    expect(await a.listModels()).toEqual([]);
  });

  it('is available with a key and lists the Claude roster', async () => {
    const a = new ClaudeAdapter({ apiKey: KEY });
    expect(await a.isAvailable()).toBe(true);
    const models = await a.listModels();
    expect(models.map((m) => m.name)).toEqual([...CLAUDE_MODELS]);
    // Opus is large-class, Haiku is fast — from the capability registry.
    expect(models.find((m) => m.name.includes('haiku'))?.speedClass).toBe('fast');
    expect(models.find((m) => m.name.includes('opus'))?.speedClass).toBe('large');
  });
});

describe('generate (F1361)', () => {
  it('sends the right headers/body and parses text + tokens', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect((init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
      expect((init.headers as Record<string, string>)['anthropic-version']).toBeTruthy();
      const body = JSON.parse(init.body as string) as { system?: string; messages: unknown[] };
      expect(body.system).toBe('be terse');
      expect(body.messages).toHaveLength(1);
      return jsonResponse(messagesBody('Hello there.'));
    });
    const a = new ClaudeAdapter({ apiKey: KEY, fetchImpl });
    const res = await a.generate({ prompt: 'hi', system: 'be terse' });
    expect(res.text).toBe('Hello there.');
    expect(res.model).toBe('claude-opus-4-8');
    expect(res.tokens).toBe(18);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('throws without a key (never hits the network)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse(messagesBody('x')));
    const a = new ClaudeAdapter({ apiKey: '', fetchImpl });
    await expect(a.generate({ prompt: 'hi' })).rejects.toThrow(/API key/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('retries + backoff (F1366)', () => {
  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn<FetchLike>(async () => {
      calls++;
      if (calls === 1) return new Response('rate limited', { status: 429 });
      return jsonResponse(messagesBody('after retry'));
    });
    const sleep = vi.fn(async () => {});
    const a = new ClaudeAdapter({ apiKey: KEY, fetchImpl, sleep });
    const res = await a.generate({ prompt: 'hi' });
    expect(res.text).toBe('after retry');
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('honours Retry-After on 429', async () => {
    let calls = 0;
    const fetchImpl = vi.fn<FetchLike>(async () => {
      calls++;
      if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '2' } });
      return jsonResponse(messagesBody('ok'));
    });
    const sleeps: number[] = [];
    const a = new ClaudeAdapter({
      apiKey: KEY,
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await a.generate({ prompt: 'hi' });
    expect(sleeps[0]).toBe(2000);
  });

  it('does not retry a 400 and surfaces the error', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response('bad', { status: 400 }));
    const a = new ClaudeAdapter({ apiKey: KEY, fetchImpl, sleep: async () => {} });
    await expect(a.generate({ prompt: 'hi' })).rejects.toThrow(/HTTP 400/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('gives up after maxRetries on persistent 500s', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response('err', { status: 500 }));
    const a = new ClaudeAdapter({ apiKey: KEY, fetchImpl, sleep: async () => {}, maxRetries: 2 });
    await expect(a.generate({ prompt: 'hi' })).rejects.toThrow(/HTTP 500/);
    // initial try + 2 retries = 3 calls
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('streaming (F1366)', () => {
  it('yields text deltas from an SSE stream', async () => {
    const sse =
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n' +
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":", world"}}\n\n' +
      'data: [DONE]\n\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(stream, { status: 200 }));
    const a = new ClaudeAdapter({ apiKey: KEY, fetchImpl });
    let out = '';
    for await (const delta of a.generateStream({ prompt: 'hi' })) out += delta;
    expect(out).toBe('Hello, world');
  });
});

describe('looksLikeApiKey (F1362)', () => {
  it('accepts well-formed keys and rejects junk', () => {
    expect(looksLikeApiKey(KEY)).toBe(true);
    expect(looksLikeApiKey('nope')).toBe(false);
    expect(looksLikeApiKey('sk-ant-')).toBe(false);
  });
});
