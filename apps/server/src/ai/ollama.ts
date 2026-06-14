/**
 * Ollama backend adapter (F1301).
 *
 * Talks to a local Ollama server (default http://127.0.0.1:11434). This is a
 * deliberately-local target, so it uses raw fetch rather than the SSRF guard
 * (which blocks loopback by design) — the URL is operator-configured, never
 * user-supplied.
 */

import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelAdapter,
  ModelInfo,
} from './adapter.js';
import { toModelInfo } from './model-registry.js';

const DEFAULT_URL = 'http://127.0.0.1:11434';

export class OllamaAdapter implements LanguageModelAdapter {
  readonly name = 'ollama';
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? process.env['FABLES_OLLAMA_URL'] ?? DEFAULT_URL).replace(/\/+$/, '');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return [];
      const body = (await res.json()) as { models?: { name: string }[] };
      return (body.models ?? []).map((m) => toModelInfo(m.name));
    } catch {
      return []; // unreachable backend → degrade gracefully (F1309)
    }
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const model = req.model ?? (await this.firstModel());
    if (!model) throw new Error('no Ollama model available');
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: req.signal ?? AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model,
        prompt: req.prompt,
        ...(req.system !== undefined ? { system: req.system } : {}),
        stream: false,
        options: {
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.maxTokens !== undefined ? { num_predict: req.maxTokens } : {}),
        },
      }),
    });
    if (!res.ok) throw new Error(`ollama generate failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      response: string;
      model: string;
      eval_count?: number;
      prompt_eval_count?: number;
    };
    return {
      text: body.response,
      model: body.model,
      tokens: (body.eval_count ?? 0) + (body.prompt_eval_count ?? 0),
    };
  }

  private async firstModel(): Promise<string | null> {
    const models = await this.listModels();
    return models[0]?.name ?? null;
  }
}
