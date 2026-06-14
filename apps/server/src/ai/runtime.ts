/**
 * AI runtime — the pluggable backend abstraction (F1303) and zero-AI graceful
 * mode (F1309).
 *
 * Holds an ordered list of language-model adapters and routes a request to the
 * first one that is currently available. When none is available, the runtime
 * reports `isAvailable() === false` so every AI feature can degrade gracefully
 * instead of failing — AI is always optional in Fables.
 */

import { AppError } from '@fables/core';
import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelAdapter,
  ModelInfo,
  SpeedClass,
} from './adapter.js';
import { selectForSpeed } from './model-registry.js';

export class AIRuntime {
  private readonly adapters: LanguageModelAdapter[] = [];

  /** Register a backend. Earlier registrations are preferred when both are up. */
  register(adapter: LanguageModelAdapter): this {
    this.adapters.push(adapter);
    return this;
  }

  /** The first adapter that is currently available, or null. */
  async activeAdapter(): Promise<LanguageModelAdapter | null> {
    for (const adapter of this.adapters) {
      if (await adapter.isAvailable()) return adapter;
    }
    return null;
  }

  /** Look up a registered adapter by its stable name, if present. */
  adapterNamed(name: string): LanguageModelAdapter | undefined {
    return this.adapters.find((a) => a.name === name);
  }

  /**
   * Generate, preferring a specific backend by name when it's available (F1363
   * per-feature routing). Falls back to the normal first-available adapter when
   * the preferred one is absent or down, so routing never breaks generation.
   */
  async generatePreferring(preferredName: string, req: GenerateRequest): Promise<GenerateResponse> {
    const preferred = this.adapterNamed(preferredName);
    if (preferred && (await preferred.isAvailable())) return preferred.generate(req);
    return this.generate(req);
  }

  /** F1309: true only when some backend can serve requests right now. */
  async isAvailable(): Promise<boolean> {
    return (await this.activeAdapter()) !== null;
  }

  /** Models available on the active backend (empty when AI is unavailable). */
  async listModels(): Promise<ModelInfo[]> {
    const adapter = await this.activeAdapter();
    return adapter ? adapter.listModels() : [];
  }

  /**
   * Generate a completion via the active backend. Throws a clear error when no
   * backend is available — callers that want graceful behaviour should check
   * {@link isAvailable} first (F1309).
   */
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const adapter = await this.activeAdapter();
    if (!adapter) {
      throw new AppError('BAD_REQUEST', 'no AI backend available — install a local model runtime');
    }
    return adapter.generate(req);
  }

  /** Pick a model for a task's speed class from the active backend (F1314). */
  async pickModel(desired: SpeedClass): Promise<ModelInfo | null> {
    return selectForSpeed(await this.listModels(), desired);
  }
}
