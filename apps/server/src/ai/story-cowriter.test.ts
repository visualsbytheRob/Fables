/**
 * Story co-writer tests (F1349 eval scenarios + F1350 tests). Exercises beats
 * (F1341), choices (F1342), scene draft (F1343), style capture (F1344),
 * consistency (F1345), gap analysis (F1346), and provenance markers (F1348) —
 * graceful, success, style-threading, and anti-hallucination paths.
 */

import { describe, expect, it } from 'vitest';
import { toModelInfo } from './model-registry.js';
import { AIRuntime } from './runtime.js';
import {
  analyzeBranchGap,
  captureStyle,
  checkConsistency,
  countGeneratedRegions,
  draftScene,
  expandChoices,
  markGenerated,
  suggestBeats,
} from './story-cowriter.js';
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

function runtimeWith(reply: (req: GenerateRequest) => string) {
  const mock = new MockAdapter(reply);
  return { runtime: new AIRuntime().register(mock), mock };
}

const offline = () => {
  const mock = new MockAdapter(() => '');
  mock.available = false;
  return new AIRuntime().register(mock);
};

describe('story co-writer — graceful when no backend (F1309)', () => {
  it('all assists return available:false', async () => {
    const rt = offline();
    expect(await suggestBeats(rt, 'scene')).toEqual({ available: false });
    expect(await expandChoices(rt, 'scene')).toEqual({ available: false });
    expect(await draftScene(rt, 'outline')).toEqual({ available: false });
    expect(await captureStyle(rt, 'sample')).toEqual({ available: false });
    expect(await checkConsistency(rt, 'scene', ['fact'])).toEqual({ available: false });
    expect(await analyzeBranchGap(rt, 'branch')).toEqual({ available: false });
  });
});

describe('beats + choices (F1341/F1342)', () => {
  it('suggests beats and threads style guidance into the prompt', async () => {
    const { runtime, mock } = runtimeWith(
      () => '{"beats":["The door creaks open","A shadow moves"]}',
    );
    const res = await suggestBeats(runtime, 'A dark hallway.', {
      tone: 'gothic',
      traits: ['short sentences'],
    });
    if (!res.available || !res.ok) throw new Error('expected beats');
    expect(res.beats).toHaveLength(2);
    expect(mock.lastRequest?.prompt).toContain('gothic');
    expect(mock.lastRequest?.prompt).toContain('short sentences');
  });

  it('drafts choices', async () => {
    const { runtime } = runtimeWith(() => '{"choices":["Open the door","Flee","Light a torch"]}');
    const res = await expandChoices(runtime, 'A dark hallway.');
    if (!res.available || !res.ok) throw new Error('expected choices');
    expect(res.choices).toContain('Flee');
  });
});

describe('scene draft + style capture (F1343/F1344)', () => {
  it('drafts scene prose from an outline', async () => {
    const { runtime } = runtimeWith(() => 'The rain fell in sheets over the silent town.');
    const res = await draftScene(runtime, 'rainy town, eerie quiet');
    if (!res.available || !res.ok) throw new Error('expected prose');
    expect(res.prose).toContain('rain');
  });

  it('captures style as tone + traits', async () => {
    const { runtime } = runtimeWith(
      () => '{"tone":"hard-boiled noir","traits":["terse","first person","present tense"]}',
    );
    const res = await captureStyle(runtime, 'I lit a cigarette. The city never sleeps.');
    if (!res.available || !res.ok) throw new Error('expected style');
    expect(res.tone).toBe('hard-boiled noir');
    expect(res.traits).toContain('terse');
  });
});

describe('consistency checker (F1345)', () => {
  it('flags contradictions grounded in supplied facts', async () => {
    const { runtime } = runtimeWith(
      () =>
        '{"issues":[{"claim":"Mira draws her sword","conflict":"Mira is established as a pacifist",' +
        '"severity":"high"}]}',
    );
    const res = await checkConsistency(runtime, 'Mira draws her sword and charges.', [
      'Mira is a committed pacifist',
    ]);
    if (!res.available || !res.ok) throw new Error('expected issues');
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0]!.severity).toBe('high');
  });

  it('short-circuits to no issues when there are no facts (no model call)', async () => {
    const { runtime, mock } = runtimeWith(() => 'should not be called');
    const res = await checkConsistency(runtime, 'anything', []);
    if (!res.available || !res.ok) throw new Error('expected ok');
    expect(res.issues).toEqual([]);
    expect(mock.lastRequest).toBeNull();
  });
});

describe('branch gap analysis (F1346)', () => {
  it('suggests ways to develop a thin branch', async () => {
    const { runtime } = runtimeWith(
      () => '{"suggestions":["Add a confrontation","Introduce a clue","Branch on trust"]}',
    );
    const res = await analyzeBranchGap(runtime, 'A dead-end path where nothing happens.');
    if (!res.available || !res.ok) throw new Error('expected suggestions');
    expect(res.suggestions.length).toBeGreaterThan(0);
  });
});

describe('provenance markers (F1348)', () => {
  it('wraps generated source and counts marked regions', () => {
    const marked = markGenerated('=== forest ===\nYou enter the woods.');
    expect(marked).toContain('⟨ai⟩');
    expect(countGeneratedRegions(marked)).toBe(1);
    expect(countGeneratedRegions(`${marked}\n${markGenerated('more')}`)).toBe(2);
    expect(countGeneratedRegions('hand-written source')).toBe(0);
  });
});

describe('story co-writer routes are wired', () => {
  it('POST /ai/story/beats reaches the handler (available:false offline)', async () => {
    const { buildApp } = await import('../app.js');
    const { loadConfig } = await import('../config.js');
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/story/beats',
        payload: { scene: 'A dark hallway.' },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: { available: boolean } }).data.available).toBe(false);
      // Validation still applies.
      const bad = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/story/beats',
        payload: { scene: '' },
      });
      expect(bad.statusCode).toBe(422);
    } finally {
      await app.close();
    }
  });
});
