import { describe, expect, it } from 'vitest';

import { StoryDebugger, evaluateWatchExpression } from './debugger.js';
import { createStoryFromSource, runStory } from './harness.js';
import { fixture } from './test-helpers.js';

/** F491–F493, F495–F496, F498: debugger APIs and the test harness. */

const DEBUG_SRC = `VAR gold = 5
-> market
=== market ===
The market hums.
~ gold = gold - 1
+ Buy a fig.
  -> orchard
+ Leave.
  -> END
=== orchard ===
Trees everywhere.
-> END
`;

describe('step-through debugging (F491)', () => {
  it('steps one instruction at a time with position info', () => {
    const dbg = new StoryDebugger(createStoryFromSource(DEBUG_SRC, { fileName: 'debug.fable' }));
    const first = dbg.step();
    expect(first.container).toBe('market');
    let steps = 0;
    while (dbg.story.status === 'running' && steps++ < 100) dbg.step();
    expect(dbg.story.status).toBe('choices');
  });

  it('stepLine advances to the next source line', () => {
    const dbg = new StoryDebugger(createStoryFromSource(DEBUG_SRC));
    const a = dbg.stepLine();
    const b = dbg.stepLine();
    expect(a.line).not.toBe(b.line);
  });

  it('stepOverChoice chooses and runs to the next stop', () => {
    const dbg = new StoryDebugger(createStoryFromSource(DEBUG_SRC));
    dbg.run();
    expect(dbg.story.status).toBe('choices');
    const stop = dbg.stepOverChoice(0);
    expect(stop.reason).toBe('done');
    expect(dbg.story.exportTranscript()).toContain('Trees everywhere.');
  });
});

describe('breakpoints (F492)', () => {
  it('breaks on entering a knot', () => {
    const dbg = new StoryDebugger(createStoryFromSource(DEBUG_SRC));
    dbg.addBreakpoint({ container: 'orchard' });
    const first = dbg.run();
    expect(first.reason).toBe('choices');
    dbg.story.choose(0);
    const stop = dbg.run();
    expect(stop.reason).toBe('breakpoint');
    expect(stop.container).toBe('orchard');
    expect(stop.breakpoint).toEqual({ container: 'orchard' });
  });

  it('breaks on a source line and supports removal', () => {
    const dbg = new StoryDebugger(createStoryFromSource(DEBUG_SRC));
    const id = dbg.addBreakpoint({ line: 5 }); // ~ gold = gold - 1
    const stop = dbg.run();
    expect(stop.reason).toBe('breakpoint');
    expect(stop.line).toBe(5);
    dbg.removeBreakpoint(id);
    expect(dbg.listBreakpoints()).toHaveLength(0);
    expect(dbg.run().reason).toBe('choices');
  });
});

describe('watch expressions (F493)', () => {
  it('evaluates expressions against live state without side effects', () => {
    const story = createStoryFromSource(DEBUG_SRC, { seed: 4 });
    story.continue();
    expect(evaluateWatchExpression(story, 'gold')).toBe(4);
    expect(evaluateWatchExpression(story, 'gold * 2 + 1')).toBe(9);
    expect(evaluateWatchExpression(story, 'market')).toBe(1); // visit count
    expect(evaluateWatchExpression(story, 'VISITED("market") > 0')).toBe(true);
    expect(evaluateWatchExpression(story, 'gold > 3 and market == 1')).toBe(true);
    const before = story.inspect().prng;
    evaluateWatchExpression(story, 'RANDOM(1, 100)');
    expect(story.inspect().prng).toBe(before); // scratch PRNG only
  });

  it('reports unknowns as error values', () => {
    const story = createStoryFromSource(DEBUG_SRC);
    story.continue();
    expect(evaluateWatchExpression(story, 'ghost_var')).toEqual({
      kind: 'error',
      message: 'unknown variable "ghost_var"',
    });
  });

  it('tracks watch lists on the debugger', () => {
    const dbg = new StoryDebugger(createStoryFromSource(DEBUG_SRC));
    dbg.story.continue();
    const id = dbg.addWatch('gold + 1');
    dbg.addWatch('VISITED("market")');
    expect(dbg.watchValues()).toEqual([
      { expression: 'gold + 1', value: 5 },
      { expression: 'VISITED("market")', value: 1 },
    ]);
    dbg.removeWatch(id);
    expect(dbg.watchValues()).toHaveLength(1);
  });
});

describe('state inspector (F495)', () => {
  it('exposes variables, temps, visit counts, and the call stack', () => {
    const src = `VAR favor = 2
-> hall
=== hall ===
~ temp mood = "wary"
In the hall, mood {mood}.
-> audience ->
Done.
-> END
=== audience ===
* Bow.
* Speak.
- ->->
`;
    const story = createStoryFromSource(src, { fileName: 'court.fable' });
    story.continue();
    const state = story.inspect();
    expect(state.status).toBe('choices');
    expect(state.variables).toEqual([{ name: 'favor', declKind: 'VAR', value: 2 }]);
    expect(state.visits['hall']).toBe(1);
    expect(state.visits['audience']).toBe(1);
    expect(state.callStack.map((f) => f.kind)).toEqual(['flow', 'tunnel']);
    expect(state.callStack[1]?.container).toBe('audience');
    expect(state.callStack[1]?.source?.file).toBe('court.fable');
    expect(state.choiceCount).toBe(2);
  });

  it('names temp slots for the current knot', () => {
    const story = createStoryFromSource('-> k\n=== k ===\n~ temp wits = 3\nWits {wits}.\n* Go.\n  -> END\n');
    story.continue();
    expect(story.inspect().temps).toEqual([{ slot: 0, name: 'wits', value: 3 }]);
  });
});

describe('time travel (F496)', () => {
  it('replays to any prior turn with identical state', () => {
    const story = createStoryFromSource(fixture('17-read-counts'), { seed: 6 });
    story.continue();
    story.choose(0);
    story.continue();
    story.choose(0);
    story.continue();
    story.choose(1);
    story.continue();
    expect(story.status).toBe('done');

    const dbg = new StoryDebugger(story);
    const atTurn2 = dbg.timeTravel(2);
    expect(atTurn2.currentTurn).toBe(2);
    expect(atTurn2.status).toBe('choices');
    expect(atTurn2.visits('spring')).toBe(3);
    // Continuing from the time-traveled story reproduces the original tail.
    atTurn2.choose(1);
    atTurn2.continue();
    expect(atTurn2.exportTranscript()).toBe(story.exportTranscript());
  });

  it('rejects out-of-range turns', () => {
    const dbg = new StoryDebugger(createStoryFromSource(DEBUG_SRC));
    dbg.story.continue();
    expect(() => dbg.timeTravel(5)).toThrow(/history has 0 choices/);
  });
});

describe('runStory harness (F498)', () => {
  it('drives a story by index and by choice-text matching', () => {
    const byIndex = runStory(fixture('03-choices-basic'), [0, 1]);
    const byText = runStory(fixture('03-choices-basic'), ['shaded trail', 'Sit and rest a while.']);
    expect(byText.transcript).toBe(byIndex.transcript);
    expect(byText.turns[1]?.chose).toBe('Sit and rest a while.');
  });

  it('reports per-turn text, tags, and available choices', () => {
    const r = runStory(fixture('03-choices-basic'), [1]);
    expect(r.turns[0]?.text).toBe('The path splits beneath an old oak.\n');
    expect(r.turns[0]?.choices).toHaveLength(3);
    expect(r.turns[1]?.choices).toHaveLength(2);
    expect(r.status).toBe('choices');
  });

  it('fails fast with the available options when a script entry mismatches', () => {
    expect(() => runStory(fixture('03-choices-basic'), ['Fly to the moon'])).toThrow(
      /scripted choice "Fly to the moon" not found; available: \[0] Take the shaded trail\./,
    );
  });

  it('surfaces front-end diagnostics without blocking execution', () => {
    const r = runStory('VAR unused = 1\nHello.\n-> END\n');
    expect(r.diagnostics.some((d) => d.code === 'FORGE209')).toBe(true);
    expect(r.transcript).toBe('Hello.');
  });
});
