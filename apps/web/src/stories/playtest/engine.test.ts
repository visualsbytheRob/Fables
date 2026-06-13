/**
 * Playtest engine tests (F531–F535, F538): client-side compile + run with
 * source attribution, hot-reload path replay, jump-to-knot and VAR overrides.
 */
import { describe, expect, it } from 'vitest';
import {
  compileBuffers,
  makeJumpSource,
  matchChoice,
  parseVarInput,
  startRun,
  takeChoice,
  transcriptOf,
} from './engine.js';
import { makeSimHost, mocksFrom } from '../knowledgeSim.js';

const STORY = `VAR mood = "wary"

-> gate

=== gate ===
The gate creaks. The fox is {mood}.
* Slip through.
  -> garden
+ Wait.
  -> gate

=== garden ===
Moonlight on moss.
-> END
`;

const files = (main: string) => new Map([['main.fable', main]]);

describe('compileBuffers (F531)', () => {
  it('compiles the buffers to a runnable program', () => {
    const built = compileBuffers(files(STORY), 'main.fable');
    expect(built.error).toBeNull();
    expect(built.program).not.toBeNull();
  });

  it('reports compile errors instead of a program', () => {
    const built = compileBuffers(files('-> nowhere\n'), 'main.fable');
    expect(built.program).toBeNull();
    expect(built.error).toBe('story has compile errors');
    expect(built.diagnostics.some((d) => d.code === 'FORGE202')).toBe(true);
  });
});

describe('startRun (F531/F538)', () => {
  it('runs to the first choice point with per-line source attribution', () => {
    const built = compileBuffers(files(STORY), 'main.fable');
    const run = startRun(built.program!, { seed: 7 });
    expect(run.status).toBe('choices');
    expect(run.choices.map((c) => c.text)).toEqual(['Slip through.', 'Wait.']);

    const textLine = run.lines.find((l) => l.kind === 'text');
    expect(textLine?.text).toContain('The gate creaks');
    expect(textLine?.file).toBe('main.fable');
    // "The gate creaks…" is line 6 of the source.
    expect(textLine?.line).toBe(6);
  });

  it('replays a recorded choice path (F533)', () => {
    const built = compileBuffers(files(STORY), 'main.fable');
    const run = startRun(built.program!, { seed: 7 }, ['Wait.', 'Slip through.']);
    expect(run.applied).toBe(2);
    expect(run.divergedAt).toBeNull();
    expect(run.status).toBe('done');
    expect(transcriptOf(run.lines)).toContain('> Wait.');
    expect(transcriptOf(run.lines)).toContain('Moonlight on moss.');
  });

  it('stops with a divergence notice when a recorded choice vanishes (F532)', () => {
    const edited = STORY.replace('* Slip through.', '* Sneak around.');
    const built = compileBuffers(files(edited), 'main.fable');
    const run = startRun(built.program!, { seed: 7 }, ['Slip through.']);
    expect(run.divergedAt).toBe(0);
    expect(run.applied).toBe(0);
    expect(run.lines.some((l) => l.kind === 'notice' && l.text.includes('no longer available'))).toBe(
      true,
    );
    expect(run.status).toBe('choices'); // playable from the divergence point
  });

  it('applies VAR overrides before the first line (F535)', () => {
    const built = compileBuffers(files(STORY), 'main.fable');
    const run = startRun(built.program!, { seed: 7, vars: { mood: '"gleeful"' } });
    expect(run.lines.find((l) => l.kind === 'text')?.text).toContain('gleeful');
  });

  it('skips unknown VAR overrides with a notice', () => {
    const built = compileBuffers(files(STORY), 'main.fable');
    const run = startRun(built.program!, { seed: 7, vars: { nope: '1' } });
    expect(run.lines.some((l) => l.kind === 'notice' && l.text.includes('nope'))).toBe(true);
  });
});

describe('takeChoice', () => {
  it('continues an interactive run', () => {
    const built = compileBuffers(files(STORY), 'main.fable');
    let run = startRun(built.program!, { seed: 7 });
    run = takeChoice(run, built.program!, 0);
    expect(run.status).toBe('done');
    expect(run.lines.some((l) => l.kind === 'choice' && l.text === 'Slip through.')).toBe(true);
  });
});

describe('makeJumpSource (F534)', () => {
  it('starts the story at the chosen knot, keeping declarations', () => {
    const built = compileBuffers(files(STORY), 'main.fable', (src) =>
      makeJumpSource(src, 'garden'),
    );
    expect(built.error).toBeNull();
    const run = startRun(built.program!, { seed: 7 });
    expect(run.status).toBe('done');
    expect(transcriptOf(run.lines)).toContain('Moonlight on moss.');
    expect(transcriptOf(run.lines)).not.toContain('The gate creaks');
  });

  it('injects before the first knot when there is no preamble flow', () => {
    const source = 'VAR x = 1\n\n=== a ===\n{x} here.\n-> END\n\n=== b ===\nB side.\n-> END\n';
    const jumped = makeJumpSource(source, 'b');
    const built = compileBuffers(files(jumped), 'main.fable');
    const run = startRun(built.program!, {});
    expect(transcriptOf(run.lines)).toContain('B side.');
  });
});

describe('knowledge sim host (F646/F647)', () => {
  const BINDING_STORY = 'Fox cunning is {@Fox.cunning}.\n-> END\n';

  it('serves mocked @entity.field reads into the transcript', () => {
    const built = compileBuffers(files(BINDING_STORY), 'main.fable');
    const sim = makeSimHost(mocksFrom({ Fox: { cunning: 9 } }));
    const run = startRun(built.program!, { seed: 7, host: sim.host });
    expect(transcriptOf(run.lines)).toContain('Fox cunning is 9.');
    expect(sim.usedLiveBindings()).toBe(false);
  });

  it('flags an unmocked entity read as a live binding (F647)', () => {
    const built = compileBuffers(files(BINDING_STORY), 'main.fable');
    const sim = makeSimHost(new Map());
    startRun(built.program!, { seed: 7, host: sim.host });
    expect(sim.usedLiveBindings()).toBe(true);
    expect(sim.log().live.has('Fox.cunning')).toBe(true);
  });
});

describe('matchChoice / parseVarInput', () => {
  it('matches exact text first, then substrings', () => {
    const views = [
      { index: 0, text: 'Go north', tags: [], sticky: false, target: '' },
      { index: 1, text: 'Go', tags: [], sticky: false, target: '' },
    ];
    expect(matchChoice(views, 'Go')).toBe(1);
    expect(matchChoice(views, 'north')).toBe(0);
    expect(matchChoice(views, 'swim')).toBe(-1);
  });

  it('parses booleans, numbers, quoted and bare strings', () => {
    expect(parseVarInput('true')).toBe(true);
    expect(parseVarInput(' 42 ')).toBe(42);
    expect(parseVarInput('-3.5')).toBe(-3.5);
    expect(parseVarInput('"hello"')).toBe('hello');
    expect(parseVarInput('hello')).toBe('hello');
  });
});
