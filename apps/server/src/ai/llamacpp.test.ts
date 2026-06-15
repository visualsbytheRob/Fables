/**
 * llama.cpp adapter tests (F1302, F1305) — injected fetch, no network.
 */

import { describe, expect, it } from 'vitest';
import { LlamaCppAdapter } from './llamacpp.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Build a Response whose body streams the given SSE frames. */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
}

describe('LlamaCppAdapter (F1302)', () => {
  it('reports availability from /health', async () => {
    const adapter = new LlamaCppAdapter({
      fetch: async (url) => {
        expect(String(url)).toContain('/health');
        return jsonResponse({ status: 'ok' });
      },
    });
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('lists models from /v1/models', async () => {
    const adapter = new LlamaCppAdapter({
      fetch: async () => jsonResponse({ data: [{ id: 'qwen2.5:7b' }] }),
    });
    const models = await adapter.listModels();
    expect(models[0]?.name).toBe('qwen2.5:7b');
  });

  it('degrades to an empty model list when unreachable', async () => {
    const adapter = new LlamaCppAdapter({
      fetch: async () => {
        throw new Error('connection refused');
      },
    });
    expect(await adapter.listModels()).toEqual([]);
    expect(await adapter.isAvailable()).toBe(false);
  });

  it('generates a completion', async () => {
    const adapter = new LlamaCppAdapter({
      fetch: async (_url, init) => {
        const body = JSON.parse((init?.body as string) ?? '{}') as { prompt: string };
        expect(body.prompt).toContain('hello');
        return jsonResponse({ content: 'world', model: 'm', tokens_predicted: 3 });
      },
    });
    const res = await adapter.generate({ prompt: 'hello' });
    expect(res.text).toBe('world');
    expect(res.tokens).toBe(3);
  });

  it('prepends the system prompt to the completion prompt', async () => {
    let seen = '';
    const adapter = new LlamaCppAdapter({
      fetch: async (_url, init) => {
        seen = (JSON.parse((init?.body as string) ?? '{}') as { prompt: string }).prompt;
        return jsonResponse({ content: 'ok' });
      },
    });
    await adapter.generate({ prompt: 'Q', system: 'You are terse.' });
    expect(seen).toBe('You are terse.\n\nQ');
  });

  it('streams token deltas over SSE (F1305)', async () => {
    const adapter = new LlamaCppAdapter({
      fetch: async () =>
        sseResponse([
          'data: {"content":"Hel","stop":false}\n\n',
          'data: {"content":"lo","stop":false}\n\n',
          'data: {"content":"","stop":true}\n\n',
        ]),
    });
    const chunks: string[] = [];
    for await (const delta of adapter.generateStream({ prompt: 'hi' })) chunks.push(delta);
    expect(chunks.join('')).toBe('Hello');
  });
});
