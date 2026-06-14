/**
 * AI command-surface tests (F1380): custom actions (F1377), multi-step workflows
 * (F1376), and the bulk abuse guard (F1379).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@fables/core';
import { openDb, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { toModelInfo } from './model-registry.js';
import { AIRuntime } from './runtime.js';
import {
  aiActionsRepo,
  assertBulkConfirmed,
  assertValidActionTemplate,
  isWorkflowStep,
  runCustomAction,
  runWorkflow,
} from './actions.js';
import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelAdapter,
  ModelInfo,
} from './adapter.js';

class MockAdapter implements LanguageModelAdapter {
  readonly name = 'mock';
  available = true;
  constructor(private readonly reply: (req: GenerateRequest) => string) {}
  async isAvailable() {
    return this.available;
  }
  async listModels(): Promise<ModelInfo[]> {
    return [toModelInfo('qwen2.5:0.5b'), toModelInfo('llama3.1:8b')];
  }
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    return { text: this.reply(req), model: req.model ?? 'mock' };
  }
}

function runtimeWith(reply: (req: GenerateRequest) => string) {
  return new AIRuntime().register(new MockAdapter(reply));
}

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
});
afterEach(() => db.close());

describe('custom action repo + validation (F1377)', () => {
  it('rejects a template that does not reference {{input}}', () => {
    expect(() => assertValidActionTemplate('no slots here')).toThrow(/input/);
  });

  it('rejects a template that uses an undeclared slot', () => {
    expect(() => assertValidActionTemplate('use {{input}} and {{other}}')).toThrow(/template/);
  });

  it('creates, lists, gets, and deletes an action', () => {
    const repo = aiActionsRepo(db);
    const a = repo.create({
      name: 'Pirate-ify',
      template: 'Rewrite as a pirate: {{input}}',
      task: 'prose',
    });
    expect(a.id).toMatch(/^act_/);
    expect(repo.list()).toHaveLength(1);
    expect(repo.get(a.id)?.name).toBe('Pirate-ify');
    expect(repo.delete(a.id)).toBe(true);
    expect(repo.get(a.id)).toBeNull();
  });

  it('rejects an unknown task', () => {
    const repo = aiActionsRepo(db);
    expect(() =>
      repo.create({ name: 'x', template: '{{input}}', task: 'nope' as never }),
    ).toThrow();
  });
});

describe('runCustomAction (F1377)', () => {
  it('runs a text action', async () => {
    const repo = aiActionsRepo(db);
    const action = repo.create({
      name: 'Echo',
      template: 'Echo: {{input}}',
      task: 'prose',
    });
    const rt = runtimeWith((req) => `ARR: ${req.prompt}`);
    const res = await runCustomAction(rt, action, 'ahoy');
    if (!res.available || !res.ok || res.output !== 'text') throw new Error('expected text');
    expect(res.text).toContain('ahoy');
  });

  it('parses JSON output actions', async () => {
    const repo = aiActionsRepo(db);
    const action = repo.create({
      name: 'Extract',
      template: 'Extract from {{input}}',
      task: 'tags',
      output: 'json',
    });
    const rt = runtimeWith(() => '{"k":"v"}');
    const res = await runCustomAction(rt, action, 'data');
    if (!res.available || !res.ok || res.output !== 'json') throw new Error('expected json');
    expect(res.json).toEqual({ k: 'v' });
  });

  it('degrades gracefully with no backend', async () => {
    const repo = aiActionsRepo(db);
    const action = repo.create({ name: 'x', template: '{{input}}', task: 'prose' });
    const rt = new AIRuntime();
    expect(await runCustomAction(rt, action, 'y')).toEqual({ available: false });
  });
});

describe('abuse guard (F1379)', () => {
  it('allows small runs and confirmed large runs', () => {
    expect(() => assertBulkConfirmed(3, false)).not.toThrow();
    expect(() => assertBulkConfirmed(50, true)).not.toThrow();
  });

  it('blocks large unconfirmed runs', () => {
    expect(() => assertBulkConfirmed(50, false)).toThrow(AppError);
  });
});

describe('workflows (F1376)', () => {
  it('runs the requested steps once each, in order', async () => {
    const rt = runtimeWith((req) => {
      if (req.system?.includes('tags')) return '{"tags":["a","b"]}';
      if (req.system?.includes('title')) return '{"title":"T"}';
      return 'a summary';
    });
    const out = await runWorkflow(
      rt,
      { title: '', body: 'Some note body about dragons.' },
      ['summarize', 'tags', 'summarize'], // duplicate should collapse
    );
    expect(out.available).toBe(true);
    expect(out.steps.map((s) => s.kind)).toEqual(['summarize', 'tags']);
  });

  it('recognises valid step kinds', () => {
    expect(isWorkflowStep('summarize')).toBe(true);
    expect(isWorkflowStep('nope')).toBe(false);
  });

  it('degrades gracefully with no backend', async () => {
    const out = await runWorkflow(new AIRuntime(), { title: '', body: 'x' }, ['summarize']);
    expect(out).toEqual({ available: false, steps: [] });
  });
});
