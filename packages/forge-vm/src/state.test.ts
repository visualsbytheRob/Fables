import { describe, expect, it } from 'vitest';

import { SaveError } from './state.js';
import { isList, makeList } from './values.js';
import type { Value } from './values.js';
import { createStoryFromSource, runStory } from './harness.js';
import { createStory } from './vm.js';
import { compileToIr } from './lower.js';
import { corpusFiles, fixture, testRng } from './test-helpers.js';

/** F441–F450: state, variables, and full state round-trips. */

describe('variable storage (F441)', () => {
  it('keeps typed globals and temp frames separate', () => {
    const story = createStoryFromSource(
      'VAR gold = 3\nVAR name = "Rey"\nVAR brave = true\n~ temp gold_x2 = gold * 2\n{name} {brave: dares|hides} with {gold_x2}.\n-> END\n',
    );
    story.continue();
    expect(story.getVariable('gold')).toBe(3);
    expect(story.getVariable('name')).toBe('Rey');
    expect(story.getVariable('brave')).toBe(true);
    expect(story.getVariable('gold_x2')).toBeUndefined(); // temps are not globals
  });

  it('temps are scoped per tunnel frame', () => {
    const src = `-> a
=== a ===
~ temp x = 1
-> b ->
After: {x}.
-> END
=== b ===
~ temp x = 99
Inside: {x}.
->->
`;
    expect(runStory(src).transcript).toBe('Inside: 99.\nAfter: 1.');
  });
});

describe('visit counts in expressions (F442)', () => {
  it('exposes read counts via bare names and VISITED()', () => {
    const r = runStory(fixture('17-read-counts'), [0, 0, 1]);
    expect(r.story.visits('spring')).toBe(3);
    const story = createStoryFromSource('-> hub\n=== hub ===\nSeen {VISITED("hub")} times.\n{hub < 3: -> hub}\n-> END\n');
    expect(story.continue()).toBe('Seen 1 times.\nSeen 2 times.\nSeen 3 times.\n');
  });
});

describe('external state injection (F443)', () => {
  it('reads host-provided values as plain variables', () => {
    const r = runStory('Weather: {world_weather}.\n-> END\n', [], {
      externalState: { world_weather: 'rainy' },
    });
    expect(r.transcript).toBe('Weather: rainy.');
  });

  it('supports function-shaped providers and errors on unknown names', () => {
    const r = runStory('Mood: {mood}.\n-> END\n', [], {
      externalState: (name) => (name === 'mood' ? 'wary' : undefined),
    });
    expect(r.transcript).toBe('Mood: wary.');
    expect(() => runStory('{nope}\n-> END\n')).toThrow(/unknown variable "nope"/);
  });
});

describe('variable observers (F444)', () => {
  it('notifies on change with old and new values, and unsubscribes', () => {
    const story = createStoryFromSource(
      'VAR favor = 0\n-> loop\n=== loop ===\n~ favor = favor + 1\nFavor {favor}.\n{favor < 3: -> loop}\n-> END\n',
    );
    const seen: string[] = [];
    const unsub = story.observeVariable('favor', (name, value, prev) => {
      seen.push(`${name}:${String(prev)}->${String(value)}`);
    });
    story.continue();
    expect(seen).toEqual(['favor:0->1', 'favor:1->2', 'favor:2->3']);
    unsub();
    story.setVariable('favor', 99);
    expect(seen).toHaveLength(3);
  });
});

describe('list semantics (F445)', () => {
  it('lists are ordered sets with origin tracking', () => {
    const story = createStoryFromSource(fixture('14-lists'));
    story.continue();
    const satchel = story.getVariable('satchel');
    expect(satchel !== undefined && isList(satchel)).toBe(true);
    if (satchel !== undefined && isList(satchel)) {
      expect(satchel.origin).toBe('satchel');
      expect(satchel.items).toEqual(['acorn', 'river stone']);
    }
  });

  it('addition deduplicates and subtraction removes', () => {
    const r = runStory(
      'VAR bag = ["a", "b"]\n~ bag = bag + "a"\n~ bag = bag + "c"\n~ bag = bag - "b"\nBag: {bag} ({COUNT(bag)}).\n-> END\n',
    );
    expect(r.transcript).toBe('Bag: a, c (2).');
  });
});

describe('turn counter & choice history (F447)', () => {
  it('counts turns and records the history', () => {
    const story = createStoryFromSource(fixture('03-choices-basic'));
    story.continue();
    expect(story.currentTurn).toBe(0);
    story.choose(1);
    story.continue();
    story.choose(0);
    story.continue();
    expect(story.currentTurn).toBe(2);
    expect(story.choiceHistory()).toEqual([
      { turn: 0, index: 1, text: 'Follow the sunny ridge.' },
      { turn: 1, index: 0, text: 'Take the shaded trail.' },
    ]);
  });
});

describe('state serialization (F448/F449)', () => {
  it('round-trips full state through JSON exactly', () => {
    const story = createStoryFromSource(fixture('24-lion-court-epic'), { seed: 9, files: corpusFiles() });
    story.continue();
    story.choose(1); // bribe
    story.continue();
    const json = JSON.parse(JSON.stringify(story.saveState())) as unknown;

    const fresh = createStoryFromSource(fixture('24-lion-court-epic'), { seed: 1234, files: corpusFiles() });
    fresh.loadState(json);
    expect(fresh.currentTurn).toBe(story.currentTurn);
    expect(fresh.getVariable('favor')).toBe(story.getVariable('favor'));
    expect(fresh.choices().map((c) => c.text)).toEqual(story.choices().map((c) => c.text));
    expect(fresh.exportTranscript()).toBe(story.exportTranscript());
  });

  it('serializes compound values (lists, divert targets)', () => {
    const src = `VAR bag = ["acorn"]
VAR dest = TARGET("end_knot")
-> hub
=== hub ===
Bag {COUNT(bag)}.
+ Go.
  -> dest
- -> hub
=== end_knot ===
Out.
-> END
`;
    const story = createStoryFromSource(src);
    story.continue();
    const state = story.saveState();
    expect(state.globals['dest']).toEqual({ $divert: 'end_knot' });
    expect(state.globals['bag']).toEqual({ $list: ['acorn'], origin: 'bag' });
    const fresh = createStoryFromSource(src);
    fresh.loadState(JSON.parse(JSON.stringify(state)));
    fresh.choose(0);
    expect(fresh.continue()).toBe('Go.\nOut.\n');
  });

  it('refuses saves from different bytecode without migrate (F449)', () => {
    const a = createStoryFromSource(fixture('03-choices-basic'));
    a.continue();
    const save = a.saveState();
    const b = createStoryFromSource(fixture('02-two-knots'));
    expect(() => b.loadState(save)).toThrow(SaveError);
    expect(() => b.loadState(save)).toThrow(/different bytecode/);
  });

  it('rejects malformed saves with clear errors (F469)', () => {
    const story = createStoryFromSource(fixture('02-two-knots'));
    expect(() => story.loadState(null)).toThrow(SaveError);
    expect(() => story.loadState({ stateVersion: 99 })).toThrow(/state version/);
    const good = story.saveState();
    expect(() => story.loadState({ ...good, frames: 'nope' })).toThrow(/flow data/);
  });
});

describe('state round-trip property tests (F450)', () => {
  const STORIES = ['03-choices-basic', '05-nested-choices', '17-read-counts', '24-lion-court-epic'] as const;

  it('serialize mid-story → resume → identical transcript, across seeds and paths', () => {
    for (const name of STORIES) {
      for (let seed = 1; seed <= 5; seed++) {
        const rng = testRng(seed * 7919);
        const { program } = compileToIr(fixture(name), { files: corpusFiles() });
        const original = createStory(program, { seed, maxSteps: 50_000 });
        let resumed: ReturnType<typeof createStory> | null = null;
        const splitAfter = 1 + Math.floor(rng() * 3);

        const snapshotInto = (): ReturnType<typeof createStory> => {
          // Snapshot mid-story and resume in a brand-new VM.
          const json = JSON.parse(JSON.stringify(original.saveState())) as unknown;
          const fresh = createStory(program, { seed: 999_999, maxSteps: 50_000 });
          fresh.loadState(json);
          return fresh;
        };

        original.continue();
        for (let t = 0; t < 8 && original.status === 'choices'; t++) {
          const pick = Math.floor(rng() * original.choices().length);
          original.choose(pick);
          original.continue();
          if (t + 1 === splitAfter) {
            resumed = snapshotInto();
          } else if (resumed !== null && resumed.status === 'choices') {
            resumed.choose(pick);
            resumed.continue();
          }
        }
        if (resumed === null) resumed = snapshotInto(); // story ended before the split point
        expect(resumed, `${name} seed ${seed}`).not.toBeNull();
        expect(resumed?.exportTranscript(), `${name} seed ${seed}`).toBe(original.exportTranscript());
        expect(resumed?.currentTurn).toBe(original.currentTurn);
      }
    }
  });

  it('saved state is pure JSON (no undefined, functions, or cycles)', () => {
    const story = createStoryFromSource(fixture('14-lists'));
    story.continue();
    const state = story.saveState();
    const roundTripped = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(roundTripped).toEqual(state);
  });
});

describe('value helpers', () => {
  it('makeList deduplicates structurally', () => {
    const l = makeList(['a', 'a', 1, 1, true] as Value[]);
    expect(l.items).toEqual(['a', 1, true]);
  });
});
