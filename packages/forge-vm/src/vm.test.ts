import { describe, expect, it } from 'vitest';

import { ForgeRuntimeError, createStory } from './vm.js';
import { compileToIr } from './lower.js';
import { serializeProgram } from './bytecode.js';
import { createStoryFromSource, runStory } from './harness.js';
import { fixture, corpusFiles } from './test-helpers.js';

/** F431–F440: the VM execution core, driven end-to-end by fixture stories. */

describe('execution loop & output buffer (F431/F432)', () => {
  it('plays a knot chain to the end', () => {
    expect(runStory(fixture('02-two-knots')).transcript).toBe(
      'The fox curled up in her den.\nSunlight crept across the moss.',
    );
  });

  it('resolves glue across line breaks (F432)', () => {
    const r = runStory(fixture('11-glue-tags'));
    expect(r.transcript).toBe('The lion yawned. It was a vast yawn.\nHe had eaten well. Twice, in fact.');
  });

  it('collects tags per line', () => {
    const r = runStory(fixture('11-glue-tags'));
    expect(r.turns[0]?.tags).toEqual(['mood: sleepy']);
    const withTags = r.story.transcript().find((t) => t.tags !== undefined);
    expect(withTags?.tags).toEqual(['mood: sleepy']);
  });

  it('drops whitespace-only lines', () => {
    expect(runStory('First.\n{false: ghost}\nLast.\n-> END\n').transcript).toBe('First.\nLast.');
  });

  it('runs accepts raw bytecode input', () => {
    const { program } = compileToIr(fixture('02-two-knots'));
    const story = createStory(serializeProgram(program));
    expect(story.continue()).toBe('The fox curled up in her den.\nSunlight crept across the moss.\n');
    expect(story.status).toBe('done');
  });
});

describe('Continue/choices/choose (F433–F435)', () => {
  it('continue() runs to the next choice point and reports choices', () => {
    const story = createStoryFromSource(fixture('03-choices-basic'));
    const text = story.continue();
    expect(text).toBe('The path splits beneath an old oak.\n');
    expect(story.status).toBe('choices');
    expect(story.choices().map((c) => c.text)).toEqual([
      'Take the shaded trail.',
      'Follow the sunny ridge.',
      'Sit and rest a while.',
    ]);
    expect(story.canContinue).toBe(false);
  });

  it('choose() resumes from the selected branch with its output text', () => {
    const story = createStoryFromSource(fixture('03-choices-basic'));
    story.continue();
    story.choose(0);
    const text = story.continue();
    expect(text).toBe('Take the shaded trail.\nFerns brush your ankles.\nThe path splits beneath an old oak.\n');
  });

  it('rejects bad choice indexes and double continues', () => {
    const story = createStoryFromSource(fixture('03-choices-basic'));
    expect(() => story.choose(0)).toThrow(/no choices/);
    story.continue();
    expect(() => story.choose(7)).toThrow(/out of range/);
    expect(() => story.continue()).toThrow(/cannot continue/);
  });

  it('chooseIndex is an alias for choose', () => {
    const story = createStoryFromSource(fixture('03-choices-basic'));
    story.continue();
    story.chooseIndex(2);
    expect(story.continue()).toContain('Sit and rest a while.');
  });
});

describe('tunnel call stack (F436)', () => {
  it('returns through tunnels and survives nested calls', () => {
    const src = `-> outer
=== outer ===
Start.
-> middle ->
End.
-> END
=== middle ===
Mid in.
-> inner ->
Mid out.
->->
=== inner ===
Deep.
->->
`;
    expect(runStory(src).transcript).toBe('Start.\nMid in.\nDeep.\nMid out.\nEnd.');
  });

  it('enforces the tunnel depth limit with diagnostics', () => {
    const src = `-> spiral
=== spiral ===
Down.
-> spiral ->
->->
`;
    expect(() => runStory(src, [], { maxCallDepth: 8 })).toThrow(/tunnel call stack overflow \(depth limit 8\)/);
  });

  it('rejects ->-> outside a tunnel', () => {
    expect(() => runStory('-> a\n=== a ===\n->->\n')).toThrow(/outside of a tunnel/);
  });
});

describe('runtime errors map to source (F437)', () => {
  it('reports file/line/column from the source map', () => {
    const src = '-> start\n\n=== start ===\nOk line.\n{mystery_var}\n-> END\n';
    try {
      runStory(src, [], { fileName: 'story.fable' });
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as ForgeRuntimeError;
      expect(err).toBeInstanceOf(ForgeRuntimeError);
      expect(err.message).toContain('unknown variable "mystery_var"');
      expect(err.location?.file).toBe('story.fable');
      expect(err.location?.line).toBe(5);
      expect(err.location?.container).toBe('start');
      expect(err.callStack.length).toBeGreaterThan(0);
    }
  });
});

describe('step budget (F438)', () => {
  it('halts runaway loops with a configurable budget', () => {
    const src = '-> loop\n=== loop ===\nSpin.\n-> loop\n';
    expect(() => runStory(src, [], { maxSteps: 500 })).toThrow(/step budget exceeded \(500 instructions\)/);
  });

  it('the fox-and-crow waiting loop trips the default-style budget', () => {
    expect(() => runStory(fixture('23-fox-and-crow'), [0, 0], { maxSteps: 10_000 })).toThrow(
      /step budget exceeded/,
    );
  });

  it('a long but finite loop completes under the default budget', () => {
    const src = `VAR n = 0
-> loop
=== loop ===
~ n = n + 1
{n >= 500: -> out}
-> loop
=== out ===
Counted {n}.
-> END
`;
    expect(runStory(src).transcript).toBe('Counted 500.');
  });
});

describe('end-to-end fixtures (F440)', () => {
  it('plays the lion court epic across includes, tunnels, and effects', () => {
    const r = runStory(fixture('24-lion-court-epic'), ['Present your tribute', 'river', 'feast'], {
      seed: 7,
      files: corpusFiles(),
    });
    expect(r.status).toBe('done');
    expect(r.transcript).toContain('Two hyenas flank the gates of Leo\'s court.');
    expect(r.transcript).toContain('Leo regards you warmly.');
    expect(r.transcript).toContain('courses! Your favor stands at 3.');
  });

  it('handles the consult-glossary branch through INCLUDEd knots', () => {
    const r = runStory(fixture('24-lion-court-epic'), ['Present', 'Say nothing', 'Consult'], {
      seed: 1,
      files: corpusFiles(),
    });
    expect(r.transcript).toContain('A reference of every beast at court.');
    expect(r.status).toBe('done');
  });

  it('plays escapes, strings, and builtins fixtures faithfully', () => {
    expect(runStory(fixture('19-escapes')).transcript).toBe(
      'The sign reads: -> market this way <>.\nA carved {rune} marks the post. # not a tag\nThe price list: 3 * fish, 2 + eggs.\n@nobody lives here.',
    );
    const builtins = runStory(fixture('22-builtins'), [], { seed: 5 }).transcript;
    expect(builtins).toMatch(/Each den gets \d+ hares?\.\nAfter 0 turns, the hunt ends\./);
  });

  it('walks the nested-choice fixture down a deep branch', () => {
    const r = runStory(fixture('05-nested-choices'), ['Tell them', 'moon']);
    expect(r.status).toBe('done');
    expect(r.transcript).toContain('They gasp at the part with the owl.');
    expect(r.transcript).toContain('They drift to sleep.');
  });
});
