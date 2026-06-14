/**
 * RAG pipeline tests (F1330): grounded answer with citations (F1321/F1322),
 * the no-good-sources refusal (F1326), confidence signalling (F1325), and
 * graceful degradation when no AI backend is available (F1309).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { toModelInfo } from '../ai/model-registry.js';
import { ragAnswer } from './rag.js';
import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelAdapter,
  ModelInfo,
} from './adapter.js';

class MockAdapter implements LanguageModelAdapter {
  readonly name = 'mock';
  lastRequest: GenerateRequest | null = null;
  constructor(private readonly reply: (req: GenerateRequest) => string) {}
  async isAvailable() {
    return true;
  }
  async listModels(): Promise<ModelInfo[]> {
    return [toModelInfo('qwen2.5:0.5b'), toModelInfo('llama3.1:8b')];
  }
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    this.lastRequest = req;
    return { text: this.reply(req), model: req.model ?? 'mock' };
  }
}

let app: FastifyInstance;
let dragonNoteId: string;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const nb = notebooksRepo(app.db).create({ name: 'Bestiary' });
  dragonNoteId = notesRepo(app.db).create({
    notebookId: nb.id,
    title: 'Dragons',
    body: 'Dragons breathe fire and hoard gold in deep mountain lairs. They fear cold iron.',
  }).id;
  notesRepo(app.db).create({
    notebookId: nb.id,
    title: 'Mountains',
    body: 'The Frostpeak mountains are tall, cold, and riddled with caves and old lairs.',
  });
  // Embed everything synchronously so retrieval has something to find.
  await app.intel.queue.backfill();
});

afterAll(async () => {
  await app.close();
});

describe('RAG — graceful when no backend (F1309)', () => {
  it('returns available:false (only the offline Ollama adapter is registered)', async () => {
    const res = await ragAnswer(app.ai, app.intel, app.db, 'What do dragons fear?');
    expect(res).toEqual({ available: false });
  });

  it('POST /ai/ask reports available:false', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/ask',
      payload: { question: 'What do dragons fear?' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { available: boolean } }).data.available).toBe(false);
  });
});

describe('RAG — grounded answers with citations (F1321/F1322/F1325/F1326)', () => {
  let mock: MockAdapter;

  beforeAll(() => {
    mock = new MockAdapter(() => 'Dragons fear cold iron [1].');
    app.ai.register(mock);
  });

  it('retrieves sources and answers with citations (F1321/F1322)', async () => {
    const res = await ragAnswer(app.ai, app.intel, app.db, 'What do dragons fear?');
    expect(res.available).toBe(true);
    if (!res.available || !res.ok) throw new Error('expected a grounded answer');
    expect(res.grounded).toBe(true);
    expect(res.answer).toContain('[1]');
    expect(res.sources.length).toBeGreaterThan(0);
    // Numbered from 1 so the [n] markers resolve.
    expect(res.sources[0]!.n).toBe(1);
    // The dragon note must be among the retrieved sources.
    expect(res.sources.some((s) => s.id === dragonNoteId)).toBe(true);
    // A confidence signal is always present for a grounded answer (F1325).
    expect(['high', 'medium', 'low']).toContain(res.confidence);
  });

  it('grounds the prompt in the FULL note body, not just the snippet', async () => {
    await ragAnswer(app.ai, app.intel, app.db, 'What do dragons fear?');
    // "cold iron" appears only at the tail of the body, beyond a 120-char snippet.
    expect(mock.lastRequest?.prompt).toContain('cold iron');
  });

  it('refuses honestly when nothing clears the relevance floor (F1326)', async () => {
    mock.lastRequest = null;
    const res = await ragAnswer(app.ai, app.intel, app.db, 'quarterly tax filing deadlines', {
      minScore: 0.999,
    });
    if (!res.available || !res.ok) throw new Error('expected a refusal outcome');
    expect(res.grounded).toBe(false);
    expect(res.sources).toEqual([]);
    expect(res.confidence).toBe('none');
    // The model is never consulted on a refusal — no hallucinated answer.
    expect(mock.lastRequest).toBeNull();
  });

  it('serves the cited answer over POST /ai/ask', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/ask',
      payload: { question: 'What do dragons fear?' },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { available: boolean; ok: boolean; sources: unknown[] } })
      .data;
    expect(data.available).toBe(true);
    expect(data.ok).toBe(true);
    expect(data.sources.length).toBeGreaterThan(0);
  });

  it('validates the question (422 on empty)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/ask',
      payload: { question: '' },
    });
    expect(res.statusCode).toBe(422);
  });
});
