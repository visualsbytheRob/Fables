/**
 * Claude cloud adapter (F1361, F1366) — implements the same LanguageModelAdapter
 * contract as the local Ollama backend, so every AI feature works identically
 * whether the active backend is on-device or in the cloud.
 *
 * Privacy posture: a cloud call sends content off the user's machine, so this
 * adapter is *opt-in*. It reports `isAvailable() === false` unless an API key is
 * configured (F1362), and the cloud policy layer gates which content may be sent
 * (egress consent F1364, per-notebook exclusions F1365). The base URL is a fixed
 * constant (api.anthropic.com) — never user-supplied — so no SSRF guard applies.
 *
 * Robustness (F1366): one-shot and streaming generation, with retry + exponential
 * backoff on 429/5xx and Retry-After awareness. The HTTP client and sleep are
 * injectable so tests exercise every path with zero real network calls (F1370).
 */

import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelAdapter,
  ModelInfo,
} from './adapter.js';
import { toModelInfo } from './model-registry.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;
const API_KEY_PREFIX = 'sk-ant-';

/**
 * Models this adapter exposes, newest/most-capable first (F1363 routing prefers
 * these). The first entry is the default model (see {@link CLAUDE_MODELS}[0] use
 * below), so Opus is the current default.
 *
 * NOTE: `claude-fable-5` is temporarily withheld (provider-blocked). To restore
 * it, add `'claude-fable-5'` back as the first entry — that also makes it the
 * default again.
 */
export const CLAUDE_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'] as const;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClaudeAdapterConfig {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  /** Default model when a request doesn't pin one. */
  defaultModel?: string | undefined;
  /** Injectable fetch (tests pass a mock; production uses global fetch). */
  fetchImpl?: FetchLike | undefined;
  /** Injectable sleep for backoff (tests pass a no-op). */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Max retry attempts on transient failures (default 3). */
  maxRetries?: number | undefined;
}

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ClaudeAdapter implements LanguageModelAdapter {
  readonly name = 'claude';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(config: ClaudeAdapterConfig = {}) {
    this.apiKey = (
      config.apiKey ??
      process.env['ANTHROPIC_API_KEY'] ??
      process.env['FABLES_CLAUDE_API_KEY'] ??
      ''
    ).trim();
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.defaultModel = config.defaultModel ?? CLAUDE_MODELS[0];
    this.fetchImpl = config.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleep = config.sleep ?? defaultSleep;
    this.maxRetries = config.maxRetries ?? 3;
  }

  /** Available iff an API key is configured — never pings the network (F1362). */
  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  /** The fixed roster of Claude models, annotated with capabilities. */
  async listModels(): Promise<ModelInfo[]> {
    if (this.apiKey.length === 0) return [];
    return CLAUDE_MODELS.map((m) => toModelInfo(m));
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    if (this.apiKey.length === 0) throw new Error('Claude API key not configured');
    const body = this.requestBody(req, false);
    const res = await this.send(body, req.signal);
    const json = (await res.json()) as MessagesResponse;
    return this.toResponse(json, req);
  }

  /**
   * Streaming completion (F1366). Yields text deltas as they arrive. Retries are
   * applied to establishing the stream, not mid-stream.
   */
  async *generateStream(req: GenerateRequest): AsyncIterable<string> {
    if (this.apiKey.length === 0) throw new Error('Claude API key not configured');
    const body = this.requestBody(req, true);
    const res = await this.send(body, req.signal);
    if (!res.body) {
      // No stream body (e.g. a mock returned a plain response) — fall back.
      const json = (await res.json()) as MessagesResponse;
      yield this.toResponse(json, req).text;
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line.
      let nl: number;
      while ((nl = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const delta = parseSseTextDelta(event);
        if (delta) yield delta;
      }
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private requestBody(req: GenerateRequest, stream: boolean): Record<string, unknown> {
    const model = req.model ?? this.defaultModel;
    // `temperature` is deprecated on some Claude 4.x models (e.g. claude-opus-4-8)
    // and sending it returns HTTP 400. Drop it for those models so the same task
    // router (which sets a per-task temperature) works across every model.
    const sendTemperature = req.temperature !== undefined && supportsTemperature(model);
    return {
      model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      // F1368: keep the request shape cache-friendly — a stable `system` prefix
      // followed by the variable user turn lets the API reuse prompt-cache hits.
      ...(req.system !== undefined ? { system: req.system } : {}),
      messages: [{ role: 'user', content: req.prompt }],
      ...(sendTemperature ? { temperature: req.temperature } : {}),
      ...(stream ? { stream: true } : {}),
    };
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  /** POST with retry + exponential backoff on 429/5xx (F1366). */
  private async send(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const url = `${this.baseUrl}/v1/messages`;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
          ...(signal ? { signal } : {}),
        });
      } catch (err) {
        // Network/transport error: retry with backoff unless we're out of attempts.
        lastErr = err;
        if (attempt === this.maxRetries) break;
        await this.sleep(backoffMs(attempt, null));
        continue;
      }
      if (res.ok) return res;
      // A definite HTTP status: retry only transient ones; surface the rest now.
      if (!isRetryable(res.status) || attempt === this.maxRetries) {
        throw new Error(`Claude request failed: HTTP ${res.status}`);
      }
      await this.sleep(backoffMs(attempt, res.headers.get('retry-after')));
    }
    throw lastErr instanceof Error ? lastErr : new Error('Claude request failed');
  }

  private toResponse(json: MessagesResponse, req: GenerateRequest): GenerateResponse {
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    const tokens =
      json.usage !== undefined
        ? (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0)
        : undefined;
    return {
      text,
      model: json.model ?? req.model ?? this.defaultModel,
      ...(tokens !== undefined ? { tokens } : {}),
    };
  }
}

/**
 * Models that have deprecated the `temperature` sampling parameter — sending it
 * returns HTTP 400. Sonnet/Haiku still accept it; the Opus 4.8 reasoning model
 * does not. Keep this list narrow and explicit.
 */
const NO_TEMPERATURE_MODELS = new Set<string>(['claude-opus-4-8']);

/** Whether a model accepts the `temperature` parameter (F1366 robustness). */
export function supportsTemperature(model: string): boolean {
  return !NO_TEMPERATURE_MODELS.has(model);
}

/** A key looks well-formed for client-side validation before any network call (F1362). */
export function looksLikeApiKey(key: string): boolean {
  return key.startsWith(API_KEY_PREFIX) && key.length >= 20;
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** Exponential backoff (250ms·2^n) honouring an optional Retry-After header. */
function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 60_000);
  }
  return Math.min(250 * 2 ** attempt, 8000);
}

/** Pull the text delta out of one Anthropic SSE event block, if present. */
function parseSseTextDelta(event: string): string | null {
  const dataLine = event.split('\n').find((l) => l.startsWith('data:'));
  if (!dataLine) return null;
  const payload = dataLine.slice(5).trim();
  if (payload === '[DONE]' || payload === '') return null;
  try {
    const parsed = JSON.parse(payload) as {
      type?: string;
      delta?: { type?: string; text?: string };
    };
    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
      return parsed.delta.text ?? null;
    }
  } catch {
    return null;
  }
  return null;
}
