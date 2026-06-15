/**
 * Art runtime (Epic 19, F1861/F1863) — the pluggable image-backend abstraction
 * and zero-backend graceful mode, mirroring the AI/TTS runtimes. Routes a request
 * to the first available adapter; when none is available, callers fall back to the
 * typographic cover (art/fallback.ts).
 */

import { AppError } from '@fables/core';
import type { ImageAdapter, ImageRequest, ImageResult } from './adapter.js';

export class ArtRuntime {
  private readonly adapters: ImageAdapter[] = [];

  register(adapter: ImageAdapter): this {
    this.adapters.push(adapter);
    return this;
  }

  adapterNamed(name: string): ImageAdapter | undefined {
    return this.adapters.find((a) => a.name === name);
  }

  /** The first adapter that is currently available, or null. */
  async activeAdapter(): Promise<ImageAdapter | null> {
    for (const adapter of this.adapters) {
      if (await adapter.isAvailable()) return adapter;
    }
    return null;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.activeAdapter()) !== null;
  }

  /** Generate via the first available backend. Throws when none is available. */
  async generate(req: ImageRequest): Promise<ImageResult> {
    const adapter = await this.activeAdapter();
    if (!adapter) throw new AppError('CONFLICT', 'no image backend is available');
    return adapter.generate(req);
  }
}
