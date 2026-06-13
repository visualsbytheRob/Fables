import { describe, expect, it } from 'vitest';

import { disasm } from './disasm.js';
import { compileToIr } from './lower.js';
import { serializeProgram } from './bytecode.js';
import { runStory } from './harness.js';
import { fixture, corpusFiles } from './test-helpers.js';

/** F421–F430: code generation, verified by behavior and golden disassembly. */

describe('codegen behavior', () => {
  it('emits text output with interpolation (F421/F446)', () => {
    const r = runStory(fixture('07-variables'));
    expect(r.transcript).toBe('Reynard returns to Bramble Hollow with 2 voles.\nHunger is now 1.');
  });

  it('handles variable load/store and temp slots (F422)', () => {
    const r = runStory('VAR total = 10\n~ temp bite = 4\n~ total = total - bite\nLeft: {total}.\n-> END\n');
    expect(r.transcript).toBe('Left: 6.');
  });

  it('evaluates arithmetic, logic, and comparison ops (F423)', () => {
    const r = runStory(fixture('08-expressions'));
    expect(r.transcript).toBe('Score: 9.\nVerdict: ready.\nPlan: scheme.\nNegation: green season.');
  });

  it('runs conditionals and sequence/cycle/shuffle alternatives (F424)', () => {
    const r = runStory(fixture('10-alternatives'), [0, 0, 0, 1], { seed: 3 });
    const herons = r.transcript.split('\n').filter((l) => l.startsWith('The heron'));
    expect(herons[0]).toBe('The heron stands.');
    expect(herons[1]).toBe('The heron still stands.');
    expect(herons[2]).toBe('The heron has not moved.');
    expect(herons[3]).toBe('The heron has not moved.'); // sequence clamps at the last branch
    const reeds = r.transcript.split('\n').filter((l) => l.startsWith('The reeds'));
    expect(reeds[0]).toBe('The reeds whisper.');
    expect(reeds[1]).toBe('The reeds rattle.');
    expect(reeds[2]).toBe('The reeds sigh.');
    expect(reeds[3]).toBe('The reeds whisper.'); // cycle wraps
  });

  it('tracks once-only visits on choice points (F425)', () => {
    const r = runStory(fixture('03-choices-basic'), [0, 0, 0]);
    // Both `*` choices consumed; only the sticky `+` remains.
    expect(r.turns[2]?.choices).toEqual(['Sit and rest a while.']);
  });

  it('compiles diverts, tunnels, and story end (F426)', () => {
    expect(runStory(fixture('13-tunnels')).transcript).toBe(
      'The cubs want to play.\nCrouch. Wiggle. Leap!\nAfter the lesson, everyone naps.',
    );
  });

  it('compiles list operations (F427)', () => {
    expect(runStory(fixture('14-lists')).transcript).toBe(
      'The acorn is safe.\nThe feather is gone.\nYou carry 2 treasures.',
    );
  });

  it('compiles entity binding reads as host calls (F428)', () => {
    const reads: string[] = [];
    const r = runStory(fixture('16-bindings'), [], {
      host: {
        resolveEntityDisplay: (name, display) => display ?? `«${name}»`,
        readEntityField: (name, field) => {
          reads.push(`${name}.${field ?? ''}`);
          return 12;
        },
        resolveNote: (title) => `[[${title}]]`,
      },
    });
    expect(reads).toEqual(['fox.health']);
    expect(r.transcript).toContain('Reynard the Fox bows low.');
    expect(r.transcript).toContain('His health sits at 12 today.');
    expect(r.transcript).toContain('[[The Trial of Reynard]]');
    expect(r.transcript).toContain('«crow» watches from the elm.');
  });

  it('instruments knot/stitch visit counts (F429)', () => {
    const r = runStory(fixture('17-read-counts'), [0, 0, 1]);
    expect(r.story.visits('spring')).toBe(3);
    expect(r.story.visits('meadow')).toBe(1);
    expect(r.transcript).toContain('3 visits to the spring brought you here.');
  });
});

describe('golden disassembly snapshots (F430)', () => {
  for (const name of ['04-choice-brackets', '09-conditionals-inline', '17-read-counts', '22-builtins']) {
    it(`disassembles ${name}`, () => {
      const { program } = compileToIr(fixture(name), { files: corpusFiles() });
      expect(disasm(serializeProgram(program))).toMatchSnapshot();
    });
  }

  it('annotates source locations when requested', () => {
    const { program } = compileToIr(fixture('01-hello'), { fileName: 'hello.fable' });
    const listing = disasm(serializeProgram(program), { sourceMap: true });
    expect(listing).toContain('; hello.fable:1:1');
    expect(listing).toMatchSnapshot();
  });
});
