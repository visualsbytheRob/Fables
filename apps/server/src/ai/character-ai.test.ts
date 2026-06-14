/**
 * Character & dialogue AI tests (F1359 dialogue eval set + F1360 tests). Covers
 * grounded dialogue (F1351), voice cards (F1352), polish (F1353), NPC interview
 * (F1354), fact extraction (F1355), relationships (F1356), names (F1357), and
 * arc tracking (F1358) — graceful, success, and grounding paths.
 */

import { describe, expect, it } from 'vitest';
import { toModelInfo } from './model-registry.js';
import { AIRuntime } from './runtime.js';
import {
  buildVoiceCard,
  extractFacts,
  generateDialogue,
  generateNames,
  interviewCharacter,
  polishDialogue,
  suggestRelationshipDynamics,
  trackArc,
} from './character-ai.js';
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

describe('character AI — graceful when no backend (F1309)', () => {
  it('all assists return available:false', async () => {
    const rt = offline();
    expect(await generateDialogue(rt, 'sheet', 'situation')).toEqual({ available: false });
    expect(await buildVoiceCard(rt, 'Mira', 'lines')).toEqual({ available: false });
    expect(await polishDialogue(rt, 'dialogue')).toEqual({ available: false });
    expect(await interviewCharacter(rt, 'sheet', 'q')).toEqual({ available: false });
    expect(await extractFacts(rt, 'transcript')).toEqual({ available: false });
    expect(await suggestRelationshipDynamics(rt, 'graph')).toEqual({ available: false });
    expect(await generateNames(rt, 'world', 'taverns')).toEqual({ available: false });
    expect(await trackArc(rt, 'Mira', 'scenes')).toEqual({ available: false });
  });
});

describe('grounded dialogue + voice (F1351/F1352/F1353)', () => {
  it('generates dialogue grounded in the sheet', async () => {
    const { runtime, mock } = runtimeWith(() => '"I keep my word," she said quietly.');
    const res = await generateDialogue(
      runtime,
      'Mira: a soft-spoken oathkeeper.',
      'Asked to break a promise.',
    );
    if (!res.available || !res.ok) throw new Error('expected dialogue');
    expect(res.dialogue).toContain('word');
    expect(mock.lastRequest?.prompt).toContain('oathkeeper');
  });

  it('builds a voice card', async () => {
    const { runtime } = runtimeWith(
      () =>
        '{"register":"formal","quirks":["never contracts"],"vocabulary":["indeed"],' +
        '"catchphrases":["As you wish"]}',
    );
    const res = await buildVoiceCard(runtime, 'Mira', '"Indeed. As you wish."');
    if (!res.available || !res.ok) throw new Error('expected voice card');
    expect(res.register).toBe('formal');
    expect(res.catchphrases).toContain('As you wish');
  });

  it('polishes dialogue', async () => {
    const { runtime } = runtimeWith(() => '"Go."');
    const res = await polishDialogue(runtime, '"I really think that you should probably go now."');
    if (!res.available || !res.ok) throw new Error('expected polish');
    expect(res.dialogue).toBe('"Go."');
  });
});

describe('interview + fact extraction (F1354/F1355)', () => {
  it('answers in character and carries history into the prompt', async () => {
    const { runtime, mock } = runtimeWith(() => 'I was born in the salt marshes.');
    const res = await interviewCharacter(
      runtime,
      'Mira: a marsh-born scout.',
      'Where are you from?',
      [{ question: 'Your name?', answer: 'Mira.' }],
    );
    if (!res.available || !res.ok) throw new Error('expected answer');
    expect(res.answer).toContain('marsh');
    expect(mock.lastRequest?.prompt).toContain('Mira.');
  });

  it('extracts facts from a transcript', async () => {
    const { runtime } = runtimeWith(
      () => '{"facts":["Born in the salt marshes","Trained as a scout"]}',
    );
    const res = await extractFacts(runtime, 'Author: where from? Mira: the salt marshes...');
    if (!res.available || !res.ok) throw new Error('expected facts');
    expect(res.facts).toHaveLength(2);
  });
});

describe('relationships, names, arc (F1356/F1357/F1358)', () => {
  it('suggests relationship dynamics', async () => {
    const { runtime } = runtimeWith(
      () =>
        '{"dynamics":[{"between":"Mira & Cael","dynamic":"old rivals turned reluctant allies"}]}',
    );
    const res = await suggestRelationshipDynamics(
      runtime,
      'Mira — scout. Cael — captain. Linked: served together.',
    );
    if (!res.available || !res.ok) throw new Error('expected dynamics');
    expect(res.dynamics[0]!.between).toBe('Mira & Cael');
  });

  it('generates world-consistent names', async () => {
    const { runtime, mock } = runtimeWith(() => '{"names":["The Brackish Lantern","Eel & Oar"]}');
    const res = await generateNames(runtime, 'A marsh trading port.', 'taverns');
    if (!res.available || !res.ok) throw new Error('expected names');
    expect(res.names).toContain('Eel & Oar');
    expect(mock.lastRequest?.prompt).toContain('taverns');
  });

  it('tracks a character arc', async () => {
    const { runtime } = runtimeWith(
      () => '{"summary":"From loner to leader","turningPoints":["Saves the crew","Takes command"]}',
    );
    const res = await trackArc(runtime, 'Mira', 'Scene 1... Scene 2...');
    if (!res.available || !res.ok) throw new Error('expected arc');
    expect(res.summary).toContain('leader');
    expect(res.turningPoints).toHaveLength(2);
  });
});
