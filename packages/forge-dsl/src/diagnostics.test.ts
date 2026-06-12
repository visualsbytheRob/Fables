import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import {
  ALL_DIAGNOSTIC_CODES,
  DIAGNOSTIC_CATALOG,
  DiagnosticBag,
  parseSuppressions,
} from './diagnostics.js';
import type { DiagnosticCode } from './diagnostics.js';
import { diagnosticToJson, diagnosticsToJson, renderDiagnostic, renderDiagnostics } from './render.js';
import { editDistance, suggestName } from './suggest.js';
import type { EntitySchema, KnowledgeResolver } from './symbols.js';
import { dirFileProvider, expectedCodes, loadFixtures } from './test-helpers.js';

const stubKnowledge: KnowledgeResolver = {
  resolveEntity(name: string): EntitySchema | null {
    if (name === 'fox' || name === 'Reynard the Fox') {
      return { name: 'fox', fields: { health: 'number', mood: 'string' } };
    }
    return null;
  },
  resolveNote(title: string): boolean {
    return title === 'The Trial of Reynard';
  },
  entityNames: () => ['fox', 'crow', 'lion'],
};

/** Sources that must produce each catalog code — used for full-catalog snapshots (F350). */
const CODE_SAMPLES: Record<DiagnosticCode, { source: string; knowledge?: boolean }> = {
  FORGE001: { source: '~ x = 1 ; 2\n' },
  FORGE002: { source: '~ x = "open\n' },
  FORGE003: { source: 'text /* never closed' },
  FORGE004: { source: '~ x = 12abc\n' },
  FORGE101: { source: '=== k extra ===\nbody\n-> END\n' },
  FORGE102: { source: '~ x = 1 + * 2\n' },
  FORGE103: { source: 'VAR lonely\n' },
  FORGE104: { source: 'The gate is {locked\n' },
  FORGE105: { source: 'Onward. ->\n' },
  FORGE106: { source: '=== ===\nnameless\n' },
  FORGE107: { source: '=== k ===\n* a\n* * * deep\n-> END\n' },
  FORGE108: { source: 'You recall [[The Ledger\n' },
  FORGE109: { source: '= floating\ntext\n' },
  FORGE110: { source: 'INCLUDE\n' },
  FORGE201: { source: '=== twice ===\n-> END\n=== twice ===\n-> END\n' },
  FORGE202: { source: '-> nowheer\n=== nowhere ===\n-> END\n' },
  FORGE203: { source: 'VAR cunning = 1\n~ cuning = 2\n{cunning}\n-> END\n' },
  FORGE204: { source: '@wolverine howls.\n-> END\n', knowledge: true },
  FORGE205: { source: 'See [[Missing Note]].\n-> END\n', knowledge: true },
  FORGE206: { source: 'INCLUDE cycle-a.fable\n-> a_knot\n' },
  FORGE207: { source: 'INCLUDE missing.fable\n' },
  FORGE208: { source: '-> a\n=== a ===\n-> END\n=== marooned ===\n-> END\n' },
  FORGE209: { source: 'VAR dusty = 1\nhello\n-> END\n' },
  FORGE301: { source: 'VAR x = 1 + "fox"\n{x}\n-> END\n' },
  FORGE302: { source: 'VAR coins = 5\n{coins: rich|poor} {coins}\n-> END\n' },
  FORGE303: { source: 'VAR n = 3\n{n has 1: yes}\n{n}\n-> END\n' },
  FORGE304: { source: '=== k ===\n-> END\nnever read\n' },
  FORGE305: { source: '=== loop ===\n* once\n  -> loop\n' },
  FORGE306: { source: '=== k ===\n->->\n' },
  FORGE307: { source: 'CONST king = "Leo"\n~ king = "Scar"\n{king}\n-> END\n' },
  FORGE308: { source: 'The count is {+}.\n-> END\n' },
  FORGE309: { source: '@fox.armour gleams.\n-> END\n', knowledge: true },
  FORGE310: { source: '=== k ===\n*\n  hidden\n  -> END\n+ leave\n  -> END\n' },
};

describe('diagnostic catalog (F342)', () => {
  it('codes are unique, stable, and well-formed', () => {
    expect(ALL_DIAGNOSTIC_CODES.length).toBe(new Set(ALL_DIAGNOSTIC_CODES).size);
    for (const code of ALL_DIAGNOSTIC_CODES) {
      expect(code).toMatch(/^FORGE\d{3}$/);
      expect(DIAGNOSTIC_CATALOG[code].title.length).toBeGreaterThan(3);
    }
  });

  it('every catalog code has a sample that produces it (F350)', () => {
    for (const code of ALL_DIAGNOSTIC_CODES) {
      const sample = CODE_SAMPLES[code];
      const result = compile(sample.source, {
        files: dirFileProvider('multi'),
        ...(sample.knowledge === true ? { knowledge: stubKnowledge } : {}),
      });
      expect(
        result.diagnostics.map((d) => d.code),
        `expected ${code} from sample`,
      ).toContain(code);
    }
  });

  for (const code of ALL_DIAGNOSTIC_CODES) {
    it(`snapshot: ${code} ${DIAGNOSTIC_CATALOG[code].title}`, () => {
      const sample = CODE_SAMPLES[code];
      const result = compile(sample.source, {
        files: dirFileProvider('multi'),
        ...(sample.knowledge === true ? { knowledge: stubKnowledge } : {}),
      });
      const diag = result.diagnostics.find((d) => d.code === code);
      expect(diag && renderDiagnostic(diag, sample.source)).toMatchSnapshot();
    });
  }
});

describe('multi-error collection (F345)', () => {
  it('reports many independent errors in one compile', () => {
    const source = '~ a = (\n~ b = "x\n-> missing_knot\n=== twice ===\n-> END\n=== twice ===\n-> END\n';
    const { diagnostics } = compile(source);
    const codes = new Set(diagnostics.map((d) => d.code));
    expect(codes.size).toBeGreaterThanOrEqual(4);
  });
});

describe('pretty renderer (F343)', () => {
  it('draws a frame with caret underlines', () => {
    const source = 'VAR cunning = 1\n~ cuning = 2\n{cunning}\n-> END\n';
    const { diagnostics } = compile(source);
    const diag = diagnostics.find((d) => d.code === 'FORGE203');
    const text = renderDiagnostic(diag!, source);
    expect(text).toContain('error[FORGE203]');
    expect(text).toContain('2 | ~ cuning = 2');
    expect(text).toContain('^^^^^^');
    expect(text).toContain('did you mean "cunning"?');
  });

  it('renders related spans and colors on demand', () => {
    const source = '=== twice ===\n-> END\n=== twice ===\n-> END\n';
    const { diagnostics } = compile(source);
    const dup = diagnostics.find((d) => d.code === 'FORGE201');
    const plain = renderDiagnostic(dup!, source);
    expect(plain).toContain('first declared here');
    const colored = renderDiagnostic(dup!, source, { color: true });
    expect(colored).toContain('[31m');
  });

  it('summarises batches', () => {
    const source = 'VAR unused = 1\n-> missing\n';
    const { diagnostics } = compile(source);
    const out = renderDiagnostics(diagnostics, source);
    expect(out).toMatch(/\d+ error/);
    expect(out).toMatch(/\d+ warning/);
    expect(renderDiagnostics([], source)).toBe('No problems found.');
  });
});

describe('JSON output (F344)', () => {
  it('emits a stable machine shape', () => {
    const source = '-> missing\n';
    const { diagnostics } = compile(source, { fileName: 'story.fable' });
    const json = diagnosticToJson(diagnostics[0]!);
    expect(json).toMatchObject({
      severity: 'error',
      code: 'FORGE202',
      file: 'story.fable',
    });
    expect(json.range.start.line).toBe(1);
    const all = JSON.parse(diagnosticsToJson(diagnostics)) as unknown[];
    expect(all).toHaveLength(diagnostics.length);
  });
});

describe('did-you-mean hints (F347)', () => {
  it('computes edit distance with transpositions', () => {
    expect(editDistance('forest', 'forest')).toBe(0);
    expect(editDistance('forest', 'forset')).toBe(1);
    expect(editDistance('fox', 'ox')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });

  it('suggests close names only', () => {
    expect(suggestName('meting', ['meeting', 'waiting'])).toBe('meeting');
    expect(suggestName('zzz', ['meeting', 'waiting'])).toBeUndefined();
  });

  it('suggests knot names on bad diverts', () => {
    const { diagnostics } = compile('-> meting\n=== meeting ===\n-> END\n');
    const diag = diagnostics.find((d) => d.code === 'FORGE202');
    expect(diag?.message).toContain('did you mean "meeting"?');
  });
});

describe('suppression comments (F348)', () => {
  it('parses forge-ignore comments', () => {
    const map = parseSuppressions('a\n// forge-ignore FORGE209 FORGE203\nb\n// forge-ignore\n');
    expect(map.get(2)).toEqual(new Set(['FORGE209', 'FORGE203']));
    expect(map.get(4)).toEqual(new Set(['all']));
  });

  it('silences a diagnostic on the same and following line', () => {
    const noisy = 'VAR dusty = 1\nhello\n-> END\n';
    expect(compile(noisy).diagnostics.some((d) => d.code === 'FORGE209')).toBe(true);

    const sameLine = 'VAR dusty = 1 // forge-ignore FORGE209\nhello\n-> END\n';
    expect(compile(sameLine).diagnostics.some((d) => d.code === 'FORGE209')).toBe(false);

    const lineAbove = '// forge-ignore FORGE209\nVAR dusty = 1\nhello\n-> END\n';
    expect(compile(lineAbove).diagnostics.some((d) => d.code === 'FORGE209')).toBe(false);

    const otherCode = 'VAR dusty = 1 // forge-ignore FORGE301\nhello\n-> END\n';
    expect(compile(otherCode).diagnostics.some((d) => d.code === 'FORGE209')).toBe(true);
  });
});

describe('severity configuration (F349)', () => {
  it('promotes warnings to errors and disables codes', () => {
    const source = 'VAR dusty = 1\nhello\n-> END\n';
    const promoted = compile(source, { severityConfig: { FORGE209: 'error' } });
    expect(promoted.ok).toBe(false);
    expect(promoted.diagnostics.find((d) => d.code === 'FORGE209')?.severity).toBe('error');

    const disabled = compile(source, { severityConfig: { FORGE209: 'off' } });
    expect(disabled.diagnostics.some((d) => d.code === 'FORGE209')).toBe(false);
    expect(disabled.ok).toBe(true);

    const demoted = compile('-> missing\n', { severityConfig: { FORGE202: 'hint' } });
    expect(demoted.ok).toBe(true);
    expect(demoted.diagnostics.find((d) => d.code === 'FORGE202')?.severity).toBe('hint');
  });
});

describe('diagnostic bag mechanics (F341)', () => {
  it('sorts by position with errors first', () => {
    const bag = new DiagnosticBag();
    const at = (line: number, col: number, offset: number) => ({
      start: { line, col, offset },
      end: { line, col: col + 1, offset: offset + 1 },
    });
    bag.add('FORGE209', at(2, 1, 10), 'later warning');
    bag.add('FORGE202', at(1, 1, 0), 'early error');
    bag.add('FORGE208', at(1, 1, 0), 'early warning');
    const sorted = bag.sorted();
    expect(sorted.map((d) => d.code)).toEqual(['FORGE202', 'FORGE208', 'FORGE209']);
    expect(bag.hasErrors).toBe(true);
    expect(bag.errors).toHaveLength(1);
  });
});

describe('error fixture corpus (F393)', () => {
  for (const fixture of loadFixtures('errors')) {
    it(`${fixture.name} produces ${expectedCodes(fixture.source).join(', ')}`, () => {
      const result = compile(fixture.source, { fileName: fixture.name });
      const got = new Set(result.diagnostics.map((d) => d.code));
      for (const code of expectedCodes(fixture.source)) {
        expect(got, `expected ${code} in ${fixture.name}`).toContain(code);
      }
    });
  }
});
