/**
 * Note-transform intelligence tests (F1340) covering rewrite (F1336), outline
 * (F1335), meeting structurer (F1337), weekly review (F1338), and link
 * suggestions (F1334) — graceful, success, and anti-hallucination paths.
 */

import { describe, expect, it } from 'vitest';
import { toModelInfo } from './model-registry.js';
import { AIRuntime } from './runtime.js';
import {
  outlineNote,
  rewriteText,
  structureMeeting,
  suggestLinks,
  weeklyReview,
} from './note-transform.js';
import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelAdapter,
  ModelInfo,
} from './adapter.js';

class MockAdapter implements LanguageModelAdapter {
  readonly name = 'mock';
  available = true;
  lastRequest: GenerateRequest | null = null;
  constructor(private readonly reply: (req: GenerateRequest) => string) {}
  async isAvailable() {
    return this.available;
  }
  async listModels(): Promise<ModelInfo[]> {
    return [toModelInfo('qwen2.5:0.5b'), toModelInfo('llama3.1:8b')];
  }
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    this.lastRequest = req;
    return { text: this.reply(req), model: req.model ?? 'mock' };
  }
}

function runtimeWith(reply: (req: GenerateRequest) => string): {
  runtime: AIRuntime;
  mock: MockAdapter;
} {
  const mock = new MockAdapter(reply);
  return { runtime: new AIRuntime().register(mock), mock };
}

const offlineRuntime = () => {
  const mock = new MockAdapter(() => '');
  mock.available = false;
  return new AIRuntime().register(mock);
};

describe('note transforms — graceful when no backend (F1309)', () => {
  it('every transform returns available:false', async () => {
    const rt = offlineRuntime();
    expect(await rewriteText(rt, 'x', 'tighten')).toEqual({ available: false });
    expect(await outlineNote(rt, 'x')).toEqual({ available: false });
    expect(await structureMeeting(rt, 'x')).toEqual({ available: false });
    expect(await weeklyReview(rt, ['x'])).toEqual({ available: false });
    expect(await suggestLinks(rt, 'x', [{ id: 'n1', title: 'A' }])).toEqual({ available: false });
  });
});

describe('rewrite (F1336)', () => {
  it('rewrites and passes the mode instruction through', async () => {
    const { runtime, mock } = runtimeWith(() => 'Tighter text.');
    const res = await rewriteText(runtime, 'Some long rambling text.', 'tighten');
    if (!res.available || !res.ok) throw new Error('expected rewrite');
    expect(res.text).toBe('Tighter text.');
    expect(mock.lastRequest?.prompt).toContain('concise');
  });
});

describe('outline (F1335)', () => {
  it('returns an outline', async () => {
    const { runtime } = runtimeWith(() => '- A\n  - B');
    const res = await outlineNote(runtime, 'messy a b notes');
    if (!res.available || !res.ok) throw new Error('expected outline');
    expect(res.outline).toContain('- A');
  });
});

describe('meeting structurer (F1337)', () => {
  it('extracts summary, decisions, and actions', async () => {
    const { runtime } = runtimeWith(
      () =>
        '{"summary":"Synced on launch","decisions":["Ship Friday"],' +
        '"actions":[{"task":"Write release notes","owner":"Rob"}]}',
    );
    const res = await structureMeeting(runtime, 'we agreed to ship friday, rob writes notes');
    if (!res.available || !res.ok) throw new Error('expected structure');
    expect(res.summary).toBe('Synced on launch');
    expect(res.decisions).toEqual(['Ship Friday']);
    expect(res.actions[0]).toEqual({ task: 'Write release notes', owner: 'Rob' });
  });

  it('reports ok:false on unparseable output', async () => {
    const { runtime } = runtimeWith(() => 'not json at all');
    const res = await structureMeeting(runtime, 'x');
    if (!res.available) throw new Error('expected available');
    expect(res.ok).toBe(false);
  });
});

describe('weekly review (F1338)', () => {
  it('drafts a review from entries', async () => {
    const { runtime, mock } = runtimeWith(() => '## This week\nGood progress.');
    const res = await weeklyReview(runtime, ['Mon: shipped X', 'Wed: fixed Y']);
    if (!res.available || !res.ok) throw new Error('expected review');
    expect(res.review).toContain('This week');
    // Both entries reach the prompt.
    expect(mock.lastRequest?.prompt).toContain('shipped X');
    expect(mock.lastRequest?.prompt).toContain('fixed Y');
  });

  it('refuses with no entries (nothing to review)', async () => {
    const { runtime } = runtimeWith(() => 'should not be called');
    const res = await weeklyReview(runtime, []);
    if (!res.available) throw new Error('expected available');
    expect(res.ok).toBe(false);
  });
});

describe('link suggestions (F1334)', () => {
  it('resolves valid targets to note ids', async () => {
    const { runtime } = runtimeWith(() => '{"links":[{"phrase":"the dragon","target":"Dragons"}]}');
    const res = await suggestLinks(runtime, 'I saw the dragon today.', [
      { id: 'note_dragons', title: 'Dragons' },
      { id: 'note_mountains', title: 'Mountains' },
    ]);
    if (!res.available || !res.ok) throw new Error('expected links');
    expect(res.links).toEqual([
      { phrase: 'the dragon', target: 'Dragons', targetId: 'note_dragons' },
    ]);
  });

  it('drops hallucinated targets not in the candidate list', async () => {
    const { runtime } = runtimeWith(() => '{"links":[{"phrase":"the wizard","target":"Wizards"}]}');
    const res = await suggestLinks(runtime, 'the wizard cast a spell', [
      { id: 'note_dragons', title: 'Dragons' },
    ]);
    if (!res.available || !res.ok) throw new Error('expected links');
    expect(res.links).toEqual([]);
  });

  it('short-circuits with no candidates (no model call)', async () => {
    const { runtime, mock } = runtimeWith(() => 'should not be called');
    const res = await suggestLinks(runtime, 'anything', []);
    if (!res.available || !res.ok) throw new Error('expected links');
    expect(res.links).toEqual([]);
    expect(mock.lastRequest).toBeNull();
  });
});
