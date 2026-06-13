/**
 * Player engine tests (F541/F542/F546/F549/F562/F567/F568): compile, play,
 * save/restore, deterministic rewind, blocks, endings and knot progress.
 */
import { describe, expect, it } from 'vitest';
import {
  SaveError,
  blocksFrom,
  chooseAndContinue,
  compileForPlay,
  currentScene,
  endingOf,
  knotProgress,
  pickSeed,
  plainTranscript,
  resumeSession,
  rewindTo,
  startSession,
  statValues,
} from './engine.js';

const SOURCE = `# title: Fixture
# stat: health / 10

VAR health = 7

-> gate

=== gate ===
The gate creaks. # scene: forest
* Slip through.
  -> garden
+ Wait by the wall.
  -> gate

=== garden ===
Chapter two begins. # chapter: Two
Moonlight on moss. # ending: moss
-> END
`;

const files = new Map([['main.fable', SOURCE]]);

function program() {
  const build = compileForPlay(files, 'main.fable');
  if (build.program === null) throw new Error(build.error ?? 'compile failed');
  return build.program;
}

describe('compileForPlay (F541)', () => {
  it('compiles the project client-side', () => {
    expect(program().meta['title']).toBe('Fixture');
  });

  it('reports a missing entry file', () => {
    const build = compileForPlay(new Map(), 'main.fable');
    expect(build.program).toBeNull();
    expect(build.error).toContain('main.fable');
  });
});

describe('session lifecycle', () => {
  it('plays to the first choice point and through to an ending', () => {
    const story = startSession(program(), 42);
    expect(story.status).toBe('choices');
    expect(plainTranscript(story.transcript())).toContain('The gate creaks.');

    chooseAndContinue(story, 0);
    expect(story.status).toBe('done');
    const text = plainTranscript(story.transcript());
    expect(text).toContain('> Slip through.');
    expect(text).toContain('Moonlight on moss.');
  });

  it('round-trips through a serialized save (F549)', () => {
    const story = startSession(program(), 7);
    chooseAndContinue(story, 1); // wait — sticky loop, still at choices
    const state = JSON.parse(JSON.stringify(story.saveState())) as unknown;

    const restored = resumeSession(program(), state);
    expect(restored.status).toBe('choices');
    expect(plainTranscript(restored.transcript())).toBe(plainTranscript(story.transcript()));
  });

  it('refuses corrupt saves loudly (F548/F469)', () => {
    expect(() => resumeSession(program(), { nope: true })).toThrow(SaveError);
  });

  it('rewinds deterministically by replaying the recorded prefix (F562)', () => {
    const story = startSession(program(), 11);
    chooseAndContinue(story, 1);
    chooseAndContinue(story, 1);
    expect(story.choiceHistory()).toHaveLength(2);

    const rewound = rewindTo(story, 1);
    expect(rewound.choiceHistory()).toHaveLength(1);
    expect(rewound.status).toBe('choices');
    // Same seed + same prefix ⇒ byte-identical transcript prefix.
    const full = plainTranscript(story.transcript());
    expect(full.startsWith(plainTranscript(rewound.transcript()))).toBe(true);
  });
});

describe('blocks (F542/F555–F557)', () => {
  it('derives paragraphs, choice echoes, chapter cards and scenes', () => {
    const story = startSession(program(), 1);
    chooseAndContinue(story, 0);
    const blocks = blocksFrom(story.transcript());

    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain('chapter');
    expect(kinds).toContain('choice');
    expect(blocks.find((b) => b.kind === 'chapter')?.text).toBe('Two');
    expect(currentScene(blocks)).toBe('forest');
  });
});

describe('endings & progress (F567/F568)', () => {
  it('names the ending from its tag and falls back to the last line', () => {
    const story = startSession(program(), 1);
    chooseAndContinue(story, 0);
    expect(endingOf(story.transcript())).toEqual({ id: 'moss', label: 'moss' });
    expect(endingOf([{ kind: 'text', text: 'It is over.' }])).toEqual({
      id: 'it-is-over',
      label: 'It is over.',
    });
  });

  it('computes % of knots visited from VM visit counts', () => {
    const story = startSession(program(), 1);
    const before = knotProgress(program(), story);
    expect(before.total).toBe(2);
    expect(before.visited).toBe(1);

    chooseAndContinue(story, 0);
    const after = knotProgress(program(), story);
    expect(after.visited).toBe(2);
    expect(after.pct).toBe(100);
  });
});

describe('stats & seeds (F546/F507)', () => {
  it('reads numeric stat values from VARs', () => {
    const story = startSession(program(), 1);
    expect(statValues(story, [{ name: 'health', max: 10 }, { name: 'missing', max: null }])).toEqual(
      [{ name: 'health', max: 10, value: 7 }],
    );
  });

  it('honours fixed seed mode and randomises otherwise', () => {
    const settings = { cover: { color: null, emoji: null }, theme: null, seedMode: 'fixed' as const, seed: 99 };
    expect(pickSeed(settings)).toBe(99);
    const random = pickSeed({ ...settings, seedMode: 'random' });
    expect(Number.isInteger(random)).toBe(true);
    expect(random).toBeGreaterThanOrEqual(0);
  });
});
