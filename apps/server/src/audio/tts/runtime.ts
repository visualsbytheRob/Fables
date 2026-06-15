/**
 * TTS runtime — the pluggable speech backend abstraction (F1601) and zero-speech
 * graceful mode, mirroring the AIRuntime in src/ai/runtime.ts.
 *
 * Holds an ordered list of speech adapters and routes a request to the first one
 * that is currently available. When none is available the runtime reports
 * `isAvailable() === false` so every audio feature can degrade gracefully — the
 * web layer can then fall back to the browser's Web Speech API (F1604) or hide
 * playback entirely.
 */

import { AppError } from '@fables/core';
import type { SynthesisRequest, SynthesisResult, TtsAdapter, Voice } from './adapter.js';

export class TtsRuntime {
  private readonly adapters: TtsAdapter[] = [];
  private disabled = false;

  /** Register an engine. Earlier registrations are preferred when both are up. */
  register(adapter: TtsAdapter): this {
    this.adapters.push(adapter);
    return this;
  }

  /** Global speech off switch — every audio feature degrades when engaged. */
  setDisabled(on: boolean): void {
    this.disabled = on;
  }

  /** Whether speech is globally disabled. */
  get isDisabled(): boolean {
    return this.disabled;
  }

  /** The first adapter that is currently available, or null (none when disabled). */
  async activeAdapter(): Promise<TtsAdapter | null> {
    if (this.disabled) return null;
    for (const adapter of this.adapters) {
      if (await adapter.isAvailable()) return adapter;
    }
    return null;
  }

  /** Look up a registered adapter by its stable name, if present. */
  adapterNamed(name: string): TtsAdapter | undefined {
    return this.adapters.find((a) => a.name === name);
  }

  /** True only when some engine can synthesize right now. */
  async isAvailable(): Promise<boolean> {
    return (await this.activeAdapter()) !== null;
  }

  /** Voice catalog across the active engine (F1602); empty when unavailable. */
  async listVoices(): Promise<Voice[]> {
    const adapter = await this.activeAdapter();
    return adapter ? adapter.listVoices() : [];
  }

  /** Synthesize via the first available engine. Throws when speech is off. */
  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const adapter = await this.activeAdapter();
    if (!adapter) {
      throw new AppError('CONFLICT', 'no speech engine is available');
    }
    return adapter.synthesize(req);
  }
}
