/**
 * Note-intelligence route tests (F1331/F1332/F1333) — graceful + success paths.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { toModelInfo } from '../ai/model-registry.js';
import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelAdapter,
  ModelInfo,
} from '../ai/adapter.js';

class MockAdapter implements LanguageModelAdapter {
  readonly name = 'mock';
  constructor(private readonly reply: (req: GenerateRequest) => string) {}
  async isAvailable() {
    return true;
  }
  async listModels(): Promise<ModelInfo[]> {
    return [toModelInfo('qwen2.5:0.5b'), toModelInfo('llama3.1:8b')];
  }
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    return { text: this.reply(req), model: req.model ?? 'mock' };
  }
}

let app: FastifyInstance;
let noteId: string;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const nb = notebooksRepo(app.db).create({ name: 'NB' });
  noteId = notesRepo(app.db).create({
    notebookId: nb.id,
    title: '',
    body: 'Dragons breathe fire and hoard gold in mountain lairs.',
  }).id;
});

afterAll(async () => {
  await app.close();
});

describe('AI note intelligence — graceful when no backend (F1309)', () => {
  it('GET /ai/status reports unavailable (only the offline Ollama adapter is registered)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/status' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { available: boolean } }).data.available).toBe(false);
  });

  it('POST /notes/:id/ai/tags returns available:false rather than erroring', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/notes/${noteId}/ai/tags` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { available: boolean } }).data.available).toBe(false);
  });

  it('404s for an unknown note', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/notes/note_nope/ai/tags' });
    expect(res.statusCode).toBe(404);
  });
});

describe('AI note intelligence — with a backend (F1331/F1332/F1333)', () => {
  beforeAll(() => {
    // Register a mock backend; the offline Ollama adapter is preferred but
    // unavailable, so the runtime falls through to this one.
    app.ai.register(
      new MockAdapter((req) => {
        if (req.system?.includes('tags')) return '{"tags":["dragons","fire","gold"]}';
        if (req.system?.includes('title')) return '{"title":"Dragon Lairs"}';
        return 'A short note about dragons.';
      }),
    );
  });

  it('suggests tags (F1332)', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/notes/${noteId}/ai/tags` });
    const data = (res.json() as { data: { available: boolean; ok?: boolean; tags?: string[] } })
      .data;
    expect(data.available).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.tags).toEqual(['dragons', 'fire', 'gold']);
  });

  it('suggests a title (F1333)', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/notes/${noteId}/ai/title` });
    const data = (res.json() as { data: { ok?: boolean; title?: string } }).data;
    expect(data.ok).toBe(true);
    expect(data.title).toBe('Dragon Lairs');
  });

  it('summarizes (F1331)', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/notes/${noteId}/ai/summary` });
    const data = (res.json() as { data: { ok?: boolean; summary?: string } }).data;
    expect(data.ok).toBe(true);
    expect(data.summary).toBe('A short note about dragons.');
  });

  it('GET /ai/status now reports available with models', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/status' });
    const data = (res.json() as { data: { available: boolean; models: ModelInfo[] } }).data;
    expect(data.available).toBe(true);
    expect(data.models.length).toBeGreaterThan(0);
  });
});
