/** Scenario recorder/runner tests (F536/F537): persistence, replay, diffing. */
import { describe, expect, it } from 'vitest';
import { compileBuffers, startRun, transcriptOf } from './engine.js';
import {
  deleteScenario,
  diffTranscripts,
  loadScenarios,
  runScenario,
  saveScenario,
  type Scenario,
} from './scenarios.js';

const STORY = `-> gate

=== gate ===
The gate creaks.
* Slip through.
  -> garden
+ Wait.
  -> gate

=== garden ===
Moonlight on moss.
-> END
`;

const programFor = (source: string) => {
  const built = compileBuffers(new Map([['main.fable', source]]), 'main.fable');
  if (built.program === null) throw new Error(built.error ?? 'no program');
  return built.program;
};

/** In-memory localStorage stand-in so tests run in node. */
const memoryStore = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

const record = (source: string, choices: string[]): Omit<Scenario, 'id' | 'createdAt'> => {
  const run = startRun(programFor(source), { seed: 11 }, choices);
  return { name: 'happy path', seed: 11, choices, baseline: transcriptOf(run.lines) };
};

describe('scenario persistence (F536)', () => {
  it('saves, lists and deletes scenarios per story', () => {
    const store = memoryStore();
    const saved = saveScenario('story-1', record(STORY, ['Slip through.']), store);
    expect(loadScenarios('story-1', store)).toHaveLength(1);
    expect(loadScenarios('story-2', store)).toHaveLength(0);
    deleteScenario('story-1', saved.id, store);
    expect(loadScenarios('story-1', store)).toHaveLength(0);
  });

  it('survives corrupt storage', () => {
    const store = memoryStore();
    store.setItem('fables.playtest.scenarios.story-1', '{nope');
    expect(loadScenarios('story-1', store)).toEqual([]);
  });
});

describe('runScenario (F537)', () => {
  it('passes when the transcript is unchanged', () => {
    const store = memoryStore();
    const scenario = saveScenario('s', record(STORY, ['Wait.', 'Slip through.']), store);
    const result = runScenario(programFor(STORY), scenario);
    expect(result.status).toBe('pass');
    expect(result.diff.every((d) => d.op === 'equal')).toBe(true);
  });

  it('fails with a line diff when prose changes', () => {
    const store = memoryStore();
    const scenario = saveScenario('s', record(STORY, ['Slip through.']), store);
    const edited = STORY.replace('Moonlight on moss.', 'Rain on stone.');
    const result = runScenario(programFor(edited), scenario);
    expect(result.status).toBe('fail');
    expect(result.diff.some((d) => d.op === 'del' && d.text === 'Moonlight on moss.')).toBe(true);
    expect(result.diff.some((d) => d.op === 'add' && d.text === 'Rain on stone.')).toBe(true);
  });

  it('fails when a recorded choice no longer exists (divergence)', () => {
    const store = memoryStore();
    const scenario = saveScenario('s', record(STORY, ['Slip through.']), store);
    const edited = STORY.replace('* Slip through.', '* Tunnel under.');
    const result = runScenario(programFor(edited), scenario);
    expect(result.status).toBe('fail');
  });
});

describe('diffTranscripts', () => {
  it('produces a minimal line diff', () => {
    const diff = diffTranscripts('a\nb\nc', 'a\nx\nc');
    expect(diff).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'add', text: 'x' },
      { op: 'equal', text: 'c' },
    ]);
  });

  it('handles empty sides', () => {
    expect(diffTranscripts('', '')).toEqual([]);
    expect(diffTranscripts('', 'a')).toEqual([{ op: 'add', text: 'a' }]);
    expect(diffTranscripts('a', '')).toEqual([{ op: 'del', text: 'a' }]);
  });
});
