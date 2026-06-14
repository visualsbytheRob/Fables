/**
 * AI runtime + adapter + model-registry tests (F1301/F1303/F1304/F1309/F1310).
 *
 * Uses a mock backend so the suite never needs a real model runtime. Also checks
 * the Ollama adapter degrades cleanly when no server is reachable.
 */

import { describe, it, expect } from 'vitest';
import { AppError } from '@fables/core';
import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelAdapter,
  ModelInfo,
} from './adapter.js';
import { AIRuntime } from './runtime.js';
import { OllamaAdapter } from './ollama.js';
import { capabilitiesFor, selectForSpeed, toModelInfo } from './model-registry.js';

class MockAdapter implements LanguageModelAdapter {
  readonly name = 'mock';
  constructor(
    private up: boolean,
    private readonly models: ModelInfo[] = [toModelInfo('llama3.1:8b')],
  ) {}
  setUp(v: boolean) {
    this.up = v;
  }
  async isAvailable() {
    return this.up;
  }
  async listModels() {
    return this.models;
  }
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    return { text: `echo:${req.prompt}`, model: req.model ?? this.models[0]!.name, tokens: 3 };
  }
}

describe('model capability registry (F1304)', () => {
  it('classifies known families and defaults unknowns', () => {
    expect(capabilitiesFor('llama3.1:8b').speedClass).toBe('balanced');
    expect(capabilitiesFor('qwen2.5:0.5b').speedClass).toBe('fast');
    expect(capabilitiesFor('something-70b').speedClass).toBe('large');
    expect(capabilitiesFor('totally-unknown-model')).toEqual({
      contextTokens: 4096,
      speedClass: 'balanced',
    });
  });

  it('selectForSpeed prefers exact, else nearest size class', () => {
    const models = [toModelInfo('qwen2.5:0.5b'), toModelInfo('something-70b')];
    expect(selectForSpeed(models, 'fast')!.name).toBe('qwen2.5:0.5b');
    expect(selectForSpeed(models, 'large')!.name).toBe('something-70b');
    // No 'balanced' present → nearest wins, never null when models exist.
    expect(selectForSpeed(models, 'balanced')).not.toBeNull();
    expect(selectForSpeed([], 'fast')).toBeNull();
  });
});

describe('AIRuntime backend abstraction (F1303) + graceful mode (F1309)', () => {
  it('reports unavailable and refuses generate when no backend is up', async () => {
    const rt = new AIRuntime().register(new MockAdapter(false));
    expect(await rt.isAvailable()).toBe(false);
    expect(await rt.listModels()).toEqual([]);
    await expect(rt.generate({ prompt: 'hi' })).rejects.toBeInstanceOf(AppError);
    await expect(rt.generate({ prompt: 'hi' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('routes to the first available backend', async () => {
    const down = new MockAdapter(false);
    const up = new MockAdapter(true);
    const rt = new AIRuntime().register(down).register(up);
    expect(await rt.isAvailable()).toBe(true);
    const res = await rt.generate({ prompt: 'ping' });
    expect(res.text).toBe('echo:ping');
  });

  it('picks a model by speed class from the active backend', async () => {
    const rt = new AIRuntime().register(
      new MockAdapter(true, [toModelInfo('qwen2.5:0.5b'), toModelInfo('llama3.1:8b')]),
    );
    expect((await rt.pickModel('fast'))!.name).toBe('qwen2.5:0.5b');
    expect((await rt.pickModel('balanced'))!.name).toBe('llama3.1:8b');
  });
});

describe('OllamaAdapter (F1301)', () => {
  it('reports unavailable when no server is reachable (graceful)', async () => {
    // Closed high port on loopback — connection refused fast.
    const adapter = new OllamaAdapter('http://127.0.0.1:59321');
    expect(await adapter.isAvailable()).toBe(false);
    expect(await adapter.listModels()).toEqual([]);
  });
});
