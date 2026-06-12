import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { parse } from './parser.js';
import { reachableKnots, resolve } from './symbols.js';
import type { EntitySchema, FileProvider, KnowledgeResolver } from './symbols.js';
import { dirFileProvider, loadFixtures } from './test-helpers.js';

const resolveSource = (source: string, options = {}) => {
  const { story } = parse(source);
  return resolve({ story, source }, options);
};

describe('symbol table (F351, F352)', () => {
  it('declares knots, stitches, labels, globals, and temps', () => {
    const source = [
      'VAR mood = 1',
      '-> woods',
      '=== woods ===',
      '~ temp t = 1',
      '* (talk) Hi. {t > 0: !}',
      '  -> woods.parley',
      '+ Leave. -> END',
      '= parley',
      '- (greeted) Words.',
      '-> END',
      '',
    ].join('\n');
    const { symbols, diagnostics } = resolveSource(source);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect([...symbols.targets.keys()].sort()).toEqual([
      'woods',
      'woods.parley',
      'woods.parley.greeted',
      'woods.talk',
    ]);
    expect([...symbols.globals.keys()]).toEqual(['mood']);
    const temps = [...symbols.temps.values()].flatMap((m) => [...m.keys()]);
    expect(temps).toEqual(['t']);
  });

  it('resolves forward references (two-pass)', () => {
    const source = '-> later\n=== later ===\n-> END\n';
    expect(resolveSource(source).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('divert target resolution (F353)', () => {
  it('resolves relative stitch and label targets within a knot', () => {
    const source = [
      '-> k',
      '=== k ===',
      '* (pick) go on',
      '- joined',
      '-> pick',
      '= s',
      '-> s2',
      '= s2',
      '-> END',
      '',
    ].join('\n');
    const errors = resolveSource(source).diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('reports unknown targets with suggestions (F356)', () => {
    const { diagnostics } = resolveSource('-> mt_doom\n=== mt_dome ===\n-> END\n');
    const diag = diagnostics.find((d) => d.code === 'FORGE202');
    expect(diag?.message).toContain('did you mean "mt_dome"?');
  });
});

describe('variable scope rules (F354)', () => {
  it('temps are knot-local', () => {
    const source = ['-> a', '=== a ===', '~ temp t = 1', '{t}', '-> b', '=== b ===', '{t}', '-> END', ''].join('\n');
    const { diagnostics } = resolveSource(source);
    const unknowns = diagnostics.filter((d) => d.code === 'FORGE203');
    expect(unknowns).toHaveLength(1);
    expect(unknowns[0]?.span.start.line).toBe(7);
  });

  it('knot and label read counts resolve as values', () => {
    const source = ['-> a', '=== a ===', '* (x) once', '- {a > 1: again} {x > 0: picked}', '-> END', ''].join('\n');
    expect(resolveSource(source).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('unknown functions are reported with suggestions', () => {
    const { diagnostics } = resolveSource('~ temp x = RANDM(1, 2)\n{x}\n-> END\n');
    const diag = diagnostics.find((d) => d.code === 'FORGE203');
    expect(diag?.message).toContain('did you mean "RANDOM"?');
  });
});

describe('duplicate declarations (F355)', () => {
  it('reports both spans for duplicate knots, vars, and temps', () => {
    const dupKnot = resolveSource('=== k ===\n-> END\n=== k ===\n-> END\n');
    const knotDiag = dupKnot.diagnostics.find((d) => d.code === 'FORGE201');
    expect(knotDiag?.related?.[0]?.span.start.line).toBe(1);
    expect(knotDiag?.span.start.line).toBe(3);

    const dupVar = resolveSource('VAR a = 1\nVAR a = 2\n{a}\n-> END\n');
    expect(dupVar.diagnostics.some((d) => d.code === 'FORGE201')).toBe(true);

    const dupTemp = resolveSource('=== k ===\n~ temp t = 1\n~ temp t = 2\n{t}\n-> END\n');
    expect(dupTemp.diagnostics.some((d) => d.code === 'FORGE201')).toBe(true);
  });
});

describe('knowledge bindings (F357)', () => {
  const knowledge: KnowledgeResolver = {
    resolveEntity(name): EntitySchema | null {
      return name === 'hero' ? { name: 'hero', fields: { health: 'number' } } : null;
    },
    resolveNote: (title) => title === 'Known Note',
    entityNames: () => ['hero', 'villain'],
  };

  it('resolves entities and notes against the injected resolver', () => {
    const good = resolveSource('@hero stands tall near [[Known Note]].\n-> END\n', { knowledge });
    expect(good.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(good.symbols.entities.size).toBe(1);

    const bad = resolveSource('@herro waves. See [[Lost Note]].\n-> END\n', { knowledge });
    const entityDiag = bad.diagnostics.find((d) => d.code === 'FORGE204');
    expect(entityDiag?.message).toContain('did you mean "hero"?');
    expect(bad.diagnostics.some((d) => d.code === 'FORGE205')).toBe(true);
  });

  it('skips binding checks when no resolver is injected', () => {
    const result = resolveSource('@mystery waves at [[Anything]].\n-> END\n');
    expect(result.diagnostics.filter((d) => d.code === 'FORGE204' || d.code === 'FORGE205')).toEqual([]);
  });
});

describe('include graph (F358)', () => {
  const files = dirFileProvider('multi');

  it('merges symbols across included files', () => {
    const main = loadFixtures('multi').find((fx) => fx.name === 'main.fable')!;
    const { story } = parse(main.source, { fileName: 'main.fable' });
    const { symbols, diagnostics } = resolve(
      { story, source: main.source, fileName: 'main.fable' },
      { files },
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(symbols.units.map((u) => u.fileName)).toEqual(['main.fable', 'forest.fable', 'river.fable']);
    expect(symbols.knots.has('forest_edge')).toBe(true);
    expect(symbols.knots.has('river_bend')).toBe(true);
  });

  it('detects include cycles (FORGE206)', () => {
    const a = loadFixtures('multi').find((fx) => fx.name === 'cycle-a.fable')!;
    const { story } = parse(a.source, { fileName: 'cycle-a.fable' });
    const { diagnostics } = resolve({ story, source: a.source, fileName: 'cycle-a.fable' }, { files });
    expect(diagnostics.some((d) => d.code === 'FORGE206')).toBe(true);
  });

  it('reports duplicate knots across files with both spans', () => {
    const main = loadFixtures('multi').find((fx) => fx.name === 'dup-main.fable')!;
    const result = compile(main.source, { fileName: 'dup-main.fable', files });
    const dup = result.diagnostics.find((d) => d.code === 'FORGE201');
    expect(dup).toBeDefined();
    expect(dup?.related?.[0]?.message).toBe('first declared here');
  });

  it('reports missing includes and missing providers (FORGE207)', () => {
    expect(
      compile('INCLUDE ghost.fable\n', { files }).diagnostics.some((d) => d.code === 'FORGE207'),
    ).toBe(true);
    expect(
      compile('INCLUDE ghost.fable\n').diagnostics.some((d) => d.code === 'FORGE207'),
    ).toBe(true);
  });
});

describe('dead knot detection (F359)', () => {
  it('flags knots unreachable from the entry point', () => {
    const source = '-> a\n=== a ===\n-> END\n=== island ===\n-> END\n';
    const { symbols, diagnostics } = resolveSource(source);
    const dead = diagnostics.filter((d) => d.code === 'FORGE208');
    expect(dead).toHaveLength(1);
    expect(dead[0]?.message).toContain('island');
    expect(reachableKnots(symbols)).toEqual(new Set(['', 'a']));
  });

  it('starts from the first knot when there is no preamble', () => {
    const source = '=== first ===\n-> second\n=== second ===\n-> END\n';
    expect(resolveSource(source).diagnostics.filter((d) => d.code === 'FORGE208')).toEqual([]);
  });

  it('follows tunnels and stitch diverts', () => {
    const source = ['-> a', '=== a ===', '-> helper ->', '-> a.s', '= s', '-> END', '=== helper ===', '->->', ''].join('\n');
    expect(resolveSource(source).diagnostics.filter((d) => d.code === 'FORGE208')).toEqual([]);
  });
});

describe('unused variables (F209 via resolver)', () => {
  it('warns on unused globals and temps, but not on used ones', () => {
    const source = 'VAR used = 1\nVAR dusty = 2\n=== k ===\n~ temp idle = 3\n{used}\n-> END\n-> k\n';
    const { diagnostics } = resolveSource(source);
    const unused = diagnostics.filter((d) => d.code === 'FORGE209');
    expect(unused.map((d) => d.message)).toEqual([
      'variable "dusty" is never used',
      'temporary "idle" is never used',
    ]);
  });
});

describe('multi-file resolution suite (F360)', () => {
  it('cross-file diverts and variables resolve', () => {
    const files: FileProvider = {
      resolve(path) {
        const sources: Record<string, string> = {
          'b.fable': '=== in_b ===\n~ shared = shared + 1\n-> in_c\n',
          'c.fable': 'INCLUDE b.fable\n=== in_c ===\n{shared}\n-> END\n',
        };
        const source = sources[path];
        return source !== undefined ? { fileName: path, source } : null;
      },
    };
    const main = 'INCLUDE c.fable\nVAR shared = 0\n-> in_b\n';
    const result = compile(main, { fileName: 'main.fable', files });
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.symbols.units).toHaveLength(3);
    // Diamond/duplicate include of b.fable is loaded only once.
    expect(result.symbols.units.filter((u) => u.fileName === 'b.fable')).toHaveLength(1);
  });
});
