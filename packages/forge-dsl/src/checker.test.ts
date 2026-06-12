import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import type { EntitySchema, KnowledgeResolver } from './symbols.js';

const codesOf = (source: string, options = {}) =>
  compile(source, options).diagnostics.map((d) => d.code);

const knowledge: KnowledgeResolver = {
  resolveEntity(name): EntitySchema | null {
    return name === 'hero'
      ? { name: 'hero', fields: { health: 'number', title: 'string', alive: 'bool' } }
      : null;
  },
  resolveNote: () => true,
};

describe('expression type checking (F361)', () => {
  it('accepts well-typed programs', () => {
    const source = [
      'VAR n = 2',
      'VAR s = "fox"',
      'VAR ok = true',
      'VAR bag = ["a"]',
      '=== k ===',
      '~ temp t = n * 2 + ABS(0 - n)',
      '~ s = s + "!"',
      '~ ok = ok && n > 1 || s == "fox!"',
      '~ bag = bag + "b"',
      '{ok: {t}|{s}} {bag has "a": yes|no}',
      '-> END',
      '-> k',
      '',
    ].join('\n');
    expect(compile(source).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('rejects mixed arithmetic and bad comparisons (FORGE301)', () => {
    expect(codesOf('VAR x = 1 + "fox"\n{x}\n-> END\n')).toContain('FORGE301');
    expect(codesOf('VAR x = "a" < "b"\n{x}\n-> END\n')).toContain('FORGE301');
    expect(codesOf('VAR x = 1 == "one"\n{x}\n-> END\n')).toContain('FORGE301');
    expect(codesOf('VAR x = true && 1\n{x}\n-> END\n')).toContain('FORGE301');
    expect(codesOf('VAR x = -"fox"\n{x}\n-> END\n')).toContain('FORGE301');
    expect(codesOf('VAR x = !"fox"\n{x}\n-> END\n')).toContain('FORGE301');
    expect(codesOf('VAR x = true ? 1 : "two"\n{x}\n-> END\n')).toContain('FORGE301');
  });

  it('checks assignments against declared types', () => {
    expect(codesOf('VAR n = 1\n~ n = "fox"\n{n}\n-> END\n')).toContain('FORGE301');
    expect(codesOf('VAR n = 1\n~ n = 2\n{n}\n-> END\n')).not.toContain('FORGE301');
  });

  it('checks builtin signatures', () => {
    expect(codesOf('VAR x = RANDOM(1)\n{x}\n-> END\n')).toContain('FORGE301');
    expect(codesOf('VAR x = FLOOR("two")\n{x}\n-> END\n')).toContain('FORGE301');
    expect(codesOf('VAR x = RANDOM(1, 6)\n{x}\n-> END\n')).not.toContain('FORGE301');
  });
});

describe('boolean conditions with coercion hints (F362)', () => {
  it('flags non-bool conditions and suggests comparisons', () => {
    const result = compile('VAR coins = 5\n{coins: rich|poor}\n{coins}\n-> END\n');
    const diag = result.diagnostics.find((d) => d.code === 'FORGE302');
    expect(diag?.message).toContain('must be a bool');
    expect(diag?.message).toContain('"x > 0"');
  });

  it('flags string and list conditions with tailored hints', () => {
    const str = compile('VAR name = "fox"\n{name: yes}\n{name}\n-> END\n');
    expect(str.diagnostics.find((d) => d.code === 'FORGE302')?.message).toContain('==');
    const list = compile('VAR bag = ["a"]\n{bag: yes}\n{COUNT(bag)}\n-> END\n');
    expect(list.diagnostics.find((d) => d.code === 'FORGE302')?.message).toContain('has');
  });

  it('checks choice conditions and ternary conditions', () => {
    expect(codesOf('VAR n = 1\n=== k ===\n* {n} go\n  -> END\n+ stay\n  -> END\n-> k\n{n}\n')).toContain('FORGE302');
    expect(codesOf('VAR n = 1\nVAR x = (n ? 1 : 2)\n{x}\n-> END\n')).toContain('FORGE302');
    expect(codesOf('VAR n = 1\n{n > 0: fine}\n-> END\n')).not.toContain('FORGE302');
  });
});

describe('list operations (F363)', () => {
  it('requires a list on the left of has/hasnt', () => {
    expect(codesOf('VAR n = 1\n{n has 2: yes}\n{n}\n-> END\n')).toContain('FORGE303');
    expect(codesOf('VAR bag = ["a"]\n{bag has "a": yes}\n-> END\n')).not.toContain('FORGE303');
    expect(codesOf('VAR bag = ["a"]\n{bag hasnt "z": yes}\n-> END\n')).not.toContain('FORGE303');
  });

  it('allows list add/remove via + and -', () => {
    const source = 'VAR bag = ["a"]\n~ bag = bag + "b"\n~ bag = bag - "a"\n{COUNT(bag)}\n-> END\n';
    expect(compile(source).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('no content after unconditional divert (F364)', () => {
  it('flags unreachable lines', () => {
    expect(codesOf('=== k ===\n-> END\nghost line\n')).toContain('FORGE304');
    expect(codesOf('=== k ===\nShe left. -> END\nghost\n')).toContain('FORGE304');
    expect(codesOf('=== k ===\n->->\nghost\n-> END\n')).toContain('FORGE304');
  });

  it('allows content after tunnel calls and gathers', () => {
    expect(codesOf('=== k ===\n-> t ->\nafter tunnel is fine\n-> END\n=== t ===\nA brief detour.\n->->\n')).not.toContain(
      'FORGE304',
    );
    expect(codesOf('=== k ===\n* a\n  -> END\n- gathered\n-> END\n')).not.toContain('FORGE304');
  });
});

describe('once-only exhaustion analysis (F365)', () => {
  it('flags revisitable knots whose choices can all run out', () => {
    expect(codesOf('=== loop ===\n* one\n  -> loop\n* two\n  -> loop\n')).toContain('FORGE305');
  });

  it('accepts sticky choices, fallbacks, or unrevisitable knots', () => {
    expect(codesOf('=== loop ===\n* one\n  -> loop\n+ stay\n  -> loop\n')).not.toContain('FORGE305');
    expect(codesOf('=== loop ===\n* one\n  -> loop\n* -> END\n')).not.toContain('FORGE305');
    expect(codesOf('=== once ===\n* one\n  -> END\n* two\n  -> END\n')).not.toContain('FORGE305');
  });
});

describe('tunnel pairing (F366)', () => {
  it('flags returns without calls and calls without returns', () => {
    expect(codesOf('=== k ===\n->->\n')).toContain('FORGE306');
    expect(codesOf('-> t ->\ndone\n-> END\n=== t ===\nno way back\n-> END\n')).toContain('FORGE306');
  });

  it('accepts paired tunnels', () => {
    expect(codesOf('-> t ->\ndone\n-> END\n=== t ===\n->->\n')).not.toContain('FORGE306');
  });
});

describe('const reassignment (F367)', () => {
  it('errors with the declaration as a related span', () => {
    const result = compile('CONST king = "Leo"\n~ king = "Scar"\n{king}\n-> END\n');
    const diag = result.diagnostics.find((d) => d.code === 'FORGE307');
    expect(diag?.severity).toBe('error');
    expect(diag?.related?.[0]?.message).toBe('declared CONST here');
    expect(codesOf('VAR x = 1\n~ x = 2\n{x}\n-> END\n')).not.toContain('FORGE307');
  });
});

describe('interpolation validation (F368)', () => {
  it('flags unparseable interpolations and types inside them', () => {
    expect(codesOf('The count is {+}.\n-> END\n')).toContain('FORGE308');
    expect(codesOf('VAR s = "a"\nTotal: {s * 2}.\n-> END\n')).toContain('FORGE301');
    expect(codesOf('VAR s = "a"\nFine: {s + "b"}.\n-> END\n')).not.toContain('FORGE301');
  });
});

describe('entity field checks (F369)', () => {
  it('validates fields against the schema with suggestions', () => {
    const result = compile('@hero.healh is low.\n-> END\n', { knowledge });
    const diag = result.diagnostics.find((d) => d.code === 'FORGE309');
    expect(diag?.message).toContain('did you mean "health"?');
    expect(codesOf('@hero.health is fine.\n-> END\n', { knowledge })).not.toContain('FORGE309');
  });

  it('types entity fields in expressions', () => {
    expect(codesOf('VAR x = @hero.health + 1\n{x}\n-> END\n', { knowledge })).not.toContain('FORGE301');
    expect(codesOf('VAR x = @hero.title + 1\n{x}\n-> END\n', { knowledge })).toContain('FORGE301');
    expect(codesOf('{@hero.alive: lives}\n-> END\n', { knowledge })).not.toContain('FORGE302');
  });
});

describe('empty choices (F346/FORGE310)', () => {
  it('warns on blank choices but not fallbacks', () => {
    expect(codesOf('=== k ===\n*\n  surprise\n  -> END\n+ ok\n  -> END\n')).toContain('FORGE310');
    expect(codesOf('=== k ===\n* take it\n  -> k\n* -> END\n')).not.toContain('FORGE310');
  });
});

describe('semantic suite sanity (F370)', () => {
  it('a clean story stays clean through every phase', () => {
    const source = [
      '# title: Clean',
      'VAR score = 0',
      '-> start',
      '=== start ===',
      '~ score = score + 1',
      'Score {score}.',
      '+ Again {score < 3: (early)|(late)}.',
      '  -> start',
      '* Stop.',
      '  -> END',
      '',
    ].join('\n');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
