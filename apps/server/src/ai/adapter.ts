/**
 * Language-model adapter interface (F1303) — the `text` capability of the
 * Modality Mesh (docs/architecture/modality-mesh.md).
 *
 * Every backend (Ollama, llama.cpp, a cloud model, or the test mock) implements
 * this one contract; callers depend on the capability, never a concrete engine.
 * Nothing here imports a model runtime, so the AI surface stays optional and the
 * app degrades gracefully when no backend is present (F1309).
 */

/** Speed/size class used for per-task model routing (F1314). */
export type SpeedClass = 'fast' | 'balanced' | 'large';

export interface ModelInfo {
  /** Backend-native model id, e.g. "llama3.1:8b". */
  name: string;
  /** Max context window in tokens (best-effort; from the capability registry). */
  contextTokens: number;
  speedClass: SpeedClass;
}

export interface GenerateRequest {
  /** Model id; when omitted the adapter picks a sensible default. */
  model?: string;
  prompt: string;
  system?: string;
  /** 0 = deterministic; higher = more varied (F1318). */
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface GenerateResponse {
  text: string;
  model: string;
  /** Total tokens used, when the backend reports it. */
  tokens?: number;
}

export interface LanguageModelAdapter {
  /** Stable backend id: 'ollama' | 'llama.cpp' | 'mock' | … */
  readonly name: string;
  /** Fast health check — true when this backend can serve requests right now. */
  isAvailable(): Promise<boolean>;
  /** Models the backend currently has available, annotated with capabilities. */
  listModels(): Promise<ModelInfo[]>;
  /** One-shot completion. */
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  /** Optional streaming completion (F1305); falls back to generate() when absent. */
  generateStream?(req: GenerateRequest): AsyncIterable<string>;
}
