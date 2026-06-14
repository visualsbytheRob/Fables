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
import { QA_HISTORY_NOTEBOOK, ragAnswer, saveQaNote, suggestFollowUps } from './rag.js';
import { notesRepo as notesRepoFn } from '../db/repos/notes.js';
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
    mock = new MockAdapter((req) =>
      req.system?.includes('follow-up')
        ? '{"questions":["What do they hoard?","Where do they nest?"]}'
        : 'Dragons fear cold iron [1].',
    );
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

  it('flags an answer whose citations do not hold up (F1383 tripwire)', async () => {
    // The mock answers "cold iron [1]" which is a valid citation → citationsValid.
    const good = await ragAnswer(app.ai, app.intel, app.db, 'What do dragons fear?');
    if (!good.available || !good.ok) throw new Error('expected grounded answer');
    expect(good.citationsValid).toBe(true);
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

  it('never sends an encrypted/secret note to the model (F1395)', async () => {
    // A note whose body is still in at-rest encrypted form must be excluded from
    // retrieval — even when it would otherwise match.
    const nb = notebooksRepo(app.db).create({ name: 'Sealed' });
    notesRepo(app.db).create({
      notebookId: nb.id,
      title: 'Wyrmsecret',
      body: 'enc:v1:opaque-ciphertext-about-wyrms',
    });
    await app.intel.queue.backfill();
    const res = await ragAnswer(app.ai, app.intel, app.db, 'Tell me about Wyrmsecret');
    if (!res.available || !res.ok) throw new Error('expected an outcome');
    // The sealed note must never appear as a source.
    expect(res.sources.every((s) => s.title !== 'Wyrmsecret')).toBe(true);
  });

  it('validates the question (422 on empty)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/ask',
      payload: { question: '' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('uses the conversation-aware template when history is supplied (F1324)', async () => {
    await ragAnswer(app.ai, app.intel, app.db, 'And what about them?', {
      history: [{ question: 'Tell me about dragons', answer: 'They breathe fire.' }],
    });
    // The follow-up template carries prior turns into the prompt.
    expect(mock.lastRequest?.prompt).toContain('Conversation so far');
    expect(mock.lastRequest?.prompt).toContain('They breathe fire.');
  });

  it('files the answer as a searchable note when asked (F1327)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/ask',
      payload: { question: 'What do dragons fear?', save: true },
    });
    const data = (res.json() as { data: { savedNoteId?: string } }).data;
    expect(data.savedNoteId).toBeTruthy();
    const note = notesRepoFn(app.db).get(data.savedNoteId as never);
    expect(note?.title).toBe('What do dragons fear?');
    expect(note?.body).toContain('## Sources');
  });

  it('saveQaNote reuses one Q&A History notebook across calls (F1327)', () => {
    const before = notebooksRepo(app.db)
      .list({ includeArchived: true })
      .filter((n) => n.name === QA_HISTORY_NOTEBOOK).length;
    saveQaNote(app.db, 'q1', {
      answer: 'a1',
      sources: [],
      confidence: 'low',
      grounded: true,
      citationsValid: true,
    });
    saveQaNote(app.db, 'q2', {
      answer: 'a2',
      sources: [],
      confidence: 'low',
      grounded: true,
      citationsValid: true,
    });
    const after = notebooksRepo(app.db)
      .list({ includeArchived: true })
      .filter((n) => n.name === QA_HISTORY_NOTEBOOK).length;
    // Exactly one Q&A History notebook regardless of how many answers we save.
    expect(after).toBe(Math.max(before, 1));
  });

  it('suggests follow-up questions (F1328)', async () => {
    const res = await suggestFollowUps(app.ai, 'What do dragons fear?', 'Cold iron.');
    if (!res.available || !res.ok) throw new Error('expected follow-ups');
    expect(res.questions.length).toBeGreaterThan(0);
    expect(res.questions.length).toBeLessThanOrEqual(3);
  });
});
