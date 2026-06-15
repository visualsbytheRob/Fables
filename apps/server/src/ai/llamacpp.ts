/**
 * llama.cpp backend adapter (F1302).
 *
 * Talks to a local `llama-server` (llama.cpp's HTTP server, default
 * http://127.0.0.1:8080) via its native `/completion` endpoint, with streaming
 * support (F1305) over its SSE response. Like the Ollama adapter this is a
 * deliberately-local, operator-configured target, so it uses raw fetch rather
 * than the SSRF guard. An injectable fetch keeps it testable without a network.
 */

import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelAdapter,
  ModelInfo,
} from './adapter.js';
import { toModelInfo } from './model-registry.js';

const DEFAULT_URL = 'http://127.0.0.1:8080';

export type FetchLike = typeof fetch;

interface CompletionResponse {
  content: string;
  model?: string;
  tokens_predicted?: number;
  tokens_evaluated?: number;
}

export class LlamaCppAdapter implements LanguageModelAdapter {
  readonly name = 'llama.cpp';
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: { baseUrl?: string; fetch?: FetchLike } = {}) {
    this.baseUrl = (options.baseUrl ?? process.env['FABLES_LLAMACPP_URL'] ?? DEFAULT_URL).replace(
      /\/+$/,
      '',
    );
    this.fetchImpl = options.fetch ?? fetch;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { data?: { id: string }[] };
      return (body.data ?? []).map((m) => toModelInfo(m.id));
    } catch {
      return []; // unreachable backend → degrade gracefully (F1309)
    }
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/completion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: req.signal ?? AbortSignal.timeout(120_000),
      body: JSON.stringify(this.buildBody(req, false)),
    });
    if (!res.ok) throw new Error(`llama.cpp completion failed: HTTP ${res.status}`);
    const body = (await res.json()) as CompletionResponse;
    return {
      text: body.content,
      model: body.model ?? req.model ?? 'llama.cpp',
      tokens: (body.tokens_predicted ?? 0) + (body.tokens_evaluated ?? 0),
    };
  }

  /** Streaming completion over SSE (F1305). Yields token deltas as they arrive. */
  async *generateStream(req: GenerateRequest): AsyncIterable<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/completion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: req.signal ?? AbortSignal.timeout(120_000),
      body: JSON.stringify(this.buildBody(req, true)),
    });
    if (!res.ok || res.body === null) {
      throw new Error(`llama.cpp stream failed: HTTP ${res.status}`);
    }
    for await (const chunk of parseSse(res.body)) {
      if (chunk.content) yield chunk.content;
      if (chunk.stop) break;
    }
  }

  private buildBody(req: GenerateRequest, stream: boolean): Record<string, unknown> {
    const prompt = req.system !== undefined ? `${req.system}\n\n${req.prompt}` : req.prompt;
    return {
      prompt,
      stream,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { n_predict: req.maxTokens } : {}),
    };
  }
}

interface SseChunk {
  content: string;
  stop: boolean;
}

/** Parse a llama.cpp SSE stream (`data: {json}\n\n` frames) into chunks. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<SseChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) {
          const json = line.slice(5).trim();
          if (json && json !== '[DONE]') {
            try {
              const parsed = JSON.parse(json) as { content?: string; stop?: boolean };
              yield { content: parsed.content ?? '', stop: parsed.stop === true };
            } catch {
              // skip malformed frame
            }
          }
        }
        nl = buffer.indexOf('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
