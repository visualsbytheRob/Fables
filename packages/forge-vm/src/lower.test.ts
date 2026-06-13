import { describe, expect, it } from 'vitest';

import { dumpIr } from './dump.js';
import { Op } from './ir.js';
import { LoweringError, compileToIr } from './lower.js';
import { validateIr } from './validate.js';
import { fixture, fixtureFiles } from './test-helpers.js';

/** F403–F410: AST → IR lowering with snapshot coverage. */

function ir(source: string, optimize = true) {
  return compileToIr(source, { optimize }).program;
}

describe('lowering (F403)', () => {
  it('lowers a story to a flat preamble + knot container tree', () => {
    const program = ir(fixture('03-choices-basic'));
    const names = program.containers.map((c) => c.name);
    expect(names).toContain('<preamble>');
    expect(names).toContain('crossroads');
    expect(program.entryContainer).toBe(0);
  });

  it('starts at the first knot when the preamble is empty of content', () => {
    const program = ir('=== alpha ===\nHi.\n-> END\n');
    const entry = program.containers[program.entryContainer];
    expect(entry?.name).toBe('alpha');
  });

  it('creates containers for stitches and labeled choices/gathers', () => {
    const program = ir(fixture('12-stitches'));
    expect(program.containers.some((c) => c.name === 'palace.throne' && c.kind === 'stitch')).toBe(true);
    const labels = ir(fixture('06-gathers-labels'));
    expect(labels.containers.some((c) => c.name === 'clearing.howl' && c.kind === 'choiceBody')).toBe(true);
    expect(labels.containers.some((c) => c.name === 'clearing.gathered' && c.kind === 'gather')).toBe(true);
  });

  it('lowers expressions to stack-op sequences (F404)', () => {
    const program = ir('VAR a = 1\n~ a = a * 2 + 3\nDone {a}.\n-> END\n', false);
    const pre = program.containers.find((c) => c.name === '<preamble>');
    const ops = pre?.instrs.map((i) => i.op) ?? [];
    expect(ops).toContain(Op.LOAD_GLOBAL);
    expect(ops).toContain(Op.MUL);
    expect(ops).toContain(Op.ADD);
    expect(ops).toContain(Op.STORE_GLOBAL);
    expect(ops).toContain(Op.PRINT);
  });

  it('lowers choices into CHOICE + PRESENT with condition refs (F405)', () => {
    const program = ir(fixture('23-fox-and-crow'));
    const meeting = program.containers.find((c) => c.name === 'meeting');
    const choices = meeting?.instrs.filter((i) => i.op === Op.CHOICE) ?? [];
    expect(choices.length).toBe(3);
    // The sneak choice has a `{cunning > 1}` condition container reference.
    const withCond = choices.filter((c) => (c.args[1] as number) !== 0);
    expect(withCond.length).toBe(1);
    expect(meeting?.instrs.some((i) => i.op === Op.PRESENT)).toBe(true);
  });

  it('lowers tunnels to call-stack ops (F406)', () => {
    const program = ir(fixture('13-tunnels'));
    const day = program.containers.find((c) => c.name === 'day');
    expect(day?.instrs.some((i) => i.op === Op.TUNNEL)).toBe(true);
    const lesson = program.containers.find((c) => c.name === 'pounce_lesson');
    expect(lesson?.instrs.some((i) => i.op === Op.TUNNEL_RETURN)).toBe(true);
  });

  it('records knowledge bindings while lowering (F417)', () => {
    const program = ir(fixture('16-bindings'));
    expect(program.bindings).toEqual(
      expect.arrayContaining([
        { kind: 'entity', name: 'Reynard the Fox' },
        { kind: 'entity', name: 'fox', field: 'health' },
        { kind: 'note', name: 'The Trial of Reynard' },
        { kind: 'entity', name: 'crow' },
      ]),
    );
  });

  it('captures story header metadata', () => {
    const program = ir(fixture('20-header-metadata'));
    expect(program.meta).toEqual({ title: 'The Council of Beasts', author: 'Aesop', version: '2' });
  });

  it('throws a LoweringError for unknown divert targets', () => {
    expect(() => ir('-> nowhere\n')).toThrow(LoweringError);
    expect(() => ir('-> nowhere\n')).toThrow(/unknown divert target "nowhere"/);
  });

  it('throws a LoweringError when assigning to a CONST or unknown variable', () => {
    expect(() => ir('CONST x = 1\n~ x = 2\nUse {x}.\n-> END\n')).toThrow(/cannot assign to constant/);
    expect(() => ir('~ ghost = 2\n-> END\n')).toThrow(/unknown variable "ghost"/);
  });
});

describe('IR validation (F407)', () => {
  it('accepts every lowered corpus fixture', () => {
    for (const name of ['01-hello', '05-nested-choices', '12-stitches', '14-lists', '23-fox-and-crow']) {
      expect(validateIr(ir(fixture(name)))).toEqual([]);
    }
  });

  it('flags dangling container references and missing terminators', () => {
    const program = ir(fixture('03-choices-basic'));
    const broken = structuredClone(program);
    const knot = broken.containers.find((c) => c.name === 'crossroads');
    (knot?.instrs[0] as unknown as { args: number[] }).args = [999];
    const issues = validateIr(broken);
    expect(issues.some((i) => i.message.includes('dangling'))).toBe(true);

    const offEnd = structuredClone(program);
    const cross = offEnd.containers.find((c) => c.name === 'crossroads');
    cross?.instrs.pop(); // drop the trailing PRESENT
    cross?.spans.pop();
    expect(validateIr(offEnd).some((i) => i.message.includes('terminator'))).toBe(true);

    const emptied = structuredClone(program);
    const pre = emptied.containers.find((c) => c.name === '<preamble>');
    pre?.instrs.pop();
    pre?.spans.pop();
    expect(validateIr(emptied).some((i) => i.message.includes('empty'))).toBe(true);
  });
});

describe('optimization (F409)', () => {
  it('folds constant expressions', () => {
    const program = ir('Result {1 + 2 * 3}.\n-> END\n');
    const pre = program.containers.find((c) => c.name === '<preamble>');
    expect(pre?.instrs.filter((i) => i.op === Op.ADD || i.op === Op.MUL)).toEqual([]);
    expect(program.consts.some((c) => c.kind === 'number' && c.value === 7)).toBe(true);
  });

  it('inlines CONST globals with literal initializers', () => {
    const program = ir('CONST name = "Leo"\nHail {name}!\n-> END\n');
    const pre = program.containers.find((c) => c.name === '<preamble>');
    expect(pre?.instrs.some((i) => i.op === Op.LOAD_GLOBAL)).toBe(false);
  });

  it('prunes dead inline-conditional branches', () => {
    const dead = ir('You see {false: a ghost|nothing}.\n-> END\n');
    const pre = dead.containers.find((c) => c.name === '<preamble>');
    expect(pre?.instrs.some((i) => i.op === Op.JUMP_IF_FALSE)).toBe(false);
    expect(dead.strings).not.toContain('a ghost');
    expect(dead.strings).toContain('nothing');
  });

  it('produces identical transcripts with and without optimization', async () => {
    const { runStory } = await import('./harness.js');
    const src = fixture('08-expressions');
    expect(runStory(src, [], { optimize: true }).transcript).toBe(
      runStory(src, [], { optimize: false }).transcript,
    );
  });

  it('keeps the unoptimized form available for tooling', () => {
    const program = ir('Result {1 + 2}.\n-> END\n', false);
    const pre = program.containers.find((c) => c.name === '<preamble>');
    expect(pre?.instrs.some((i) => i.op === Op.ADD)).toBe(true);
  });
});

describe('lowering snapshots (F410)', () => {
  for (const name of ['03-choices-basic', '06-gathers-labels', '10-alternatives', '13-tunnels']) {
    it(`dumps stable IR for ${name}`, () => {
      expect(dumpIr(ir(fixture(name)))).toMatchSnapshot();
    });
  }

  it('dumps the multi-file include fixture', () => {
    const { source, files } = fixtureFiles('main.fable');
    expect(dumpIr(compileToIr(source, { files }).program)).toMatchSnapshot();
  });
});
