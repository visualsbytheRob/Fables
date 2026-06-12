import { describe, expect, it } from 'vitest';
import type { ChoiceNode, DivertLineNode, LogicLineNode, TextLineNode } from './ast.js';
import { parse } from './parser.js';
import { printExpr } from './printer.js';
import { astToPlainObject } from './serialize.js';

const errorsOf = (source: string) =>
  parse(source).diagnostics.filter((d) => d.severity === 'error');

describe('parser: story structure (F322)', () => {
  it('parses header tags, includes, declarations, preamble, and knots', () => {
    const { story } = parse(
      '# title: T\n# author: A\n\nINCLUDE other.fable\nVAR x = 1\nIntro line.\n-> one\n\n=== one ===\nBody.\n-> END\n',
    );
    expect(story.headerTags.map((t) => t.text)).toEqual(['title: T', 'author: A']);
    expect(story.includes.map((i) => i.path)).toEqual(['other.fable']);
    expect(story.declarations.map((d) => d.name.name)).toEqual(['x']);
    expect(story.preamble.items.map((i) => i.kind)).toEqual(['TextLine', 'DivertLine']);
    expect(story.knots.map((k) => k.name.name)).toEqual(['one']);
  });

  it('parses stitches inside knots', () => {
    const { story } = parse('=== k ===\ntop\n= s1\na\n= s2\nb\n');
    const knot = story.knots[0];
    expect(knot?.stitches.map((s) => s.name.name)).toEqual(['s1', 's2']);
    expect(knot?.body.items).toHaveLength(1);
  });

  it('reports stitches outside knots (FORGE109)', () => {
    const diags = parse('= floating\ntext\n').diagnostics;
    expect(diags.some((d) => d.code === 'FORGE109')).toBe(true);
  });

  it('hoists VAR declarations found inside knots', () => {
    const { story } = parse('=== k ===\nVAR x = 1\ntext\n');
    expect(story.declarations.map((d) => d.name.name)).toEqual(['x']);
  });
});

describe('parser: choices (F323)', () => {
  it('parses nesting depth, stickiness, labels, and conditions', () => {
    const { story } = parse(
      '=== k ===\n* (one) {a} {b} First\n* * Nested\n+ Sticky\n',
    );
    const [c1, c2] = story.knots[0]?.body.items ?? [];
    const first = c1 as ChoiceNode;
    expect(first.depth).toBe(1);
    expect(first.label?.name).toBe('one');
    expect(first.conditions.map((c) => printExpr(c))).toEqual(['a', 'b']);
    const nested = first.body.items[0] as ChoiceNode;
    expect(nested.kind).toBe('Choice');
    expect(nested.depth).toBe(2);
    expect((c2 as ChoiceNode).sticky).toBe(true);
  });

  it('splits [bracket] choice text from output text', () => {
    const { story } = parse('=== k ===\n* Shared [choice-only] output-only\n');
    const choice = story.knots[0]?.body.items[0] as ChoiceNode;
    expect(choice.prefix.map((s) => (s.kind === 'Text' ? s.text : s.kind))).toEqual(['Shared ']);
    expect(choice.choiceOnly?.map((s) => (s.kind === 'Text' ? s.text : s.kind))).toEqual([
      'choice-only',
    ]);
    expect(choice.outputOnly.map((s) => (s.kind === 'Text' ? s.text : s.kind))).toEqual([
      ' output-only',
    ]);
  });

  it('nests gathers and reattaches following content (weave)', () => {
    const { story } = parse('=== k ===\n* a\n  inside a\n* b\n- joined\nafter\n');
    const items = story.knots[0]?.body.items ?? [];
    expect(items.map((i) => i.kind)).toEqual(['Choice', 'Choice', 'Gather', 'TextLine']);
    expect((items[0] as ChoiceNode).body.items.map((i) => i.kind)).toEqual(['TextLine']);
  });

  it('warns when nesting skips a level (FORGE107)', () => {
    const diags = parse('=== k ===\n* a\n* * * way too deep\n').diagnostics;
    expect(diags.some((d) => d.code === 'FORGE107')).toBe(true);
  });
});

describe('parser: expressions (F324)', () => {
  const exprOf = (logic: string): string => {
    const { story } = parse(`=== k ===\n~ x = ${logic}\n`);
    const line = story.knots[0]?.body.items[0] as LogicLineNode;
    const stmt = line.stmt;
    return stmt.kind === 'Assign' ? printExpr(stmt.value) : '?';
  };

  it('honours precedence', () => {
    expect(exprOf('1 + 2 * 3')).toBe('1 + 2 * 3');
    expect(exprOf('(1 + 2) * 3')).toBe('(1 + 2) * 3');
    expect(exprOf('a or b and c')).toBe('a || b && c');
    expect(exprOf('not a or b')).toBe('!a || b');
    expect(exprOf('1 < 2 == true')).toBe('1 < 2 == true');
  });

  it('parses unary, ternary, calls, lists, and member paths', () => {
    expect(exprOf('-x + 1')).toBe('-x + 1');
    expect(exprOf('a > 1 ? "big" : "small"')).toBe('a > 1 ? "big" : "small"');
    expect(exprOf('MIN(1, MAX(2, 3))')).toBe('MIN(1, MAX(2, 3))');
    expect(exprOf('["a", "b"] has "a"')).toBe('["a", "b"] has "a"');
    expect(exprOf('woods.clearing > 0')).toBe('woods.clearing > 0');
  });

  it('recovers from invalid expressions (FORGE102)', () => {
    const diags = parse('=== k ===\n~ x = 1 + * 2\nnext line is fine\n').diagnostics;
    expect(diags.some((d) => d.code === 'FORGE102')).toBe(true);
  });
});

describe('parser: logic lines (F325)', () => {
  it('parses temp declarations, assignments, and calls', () => {
    const { story } = parse('=== k ===\n~ temp t = 1\n~ t = t + 1\n~ RANDOM(1, 6)\n');
    const stmts = (story.knots[0]?.body.items as LogicLineNode[]).map((l) => l.stmt.kind);
    expect(stmts).toEqual(['TempDecl', 'Assign', 'ExprStmt']);
  });

  it('requires initialisers on declarations (FORGE103)', () => {
    expect(parse('VAR x\n').diagnostics.some((d) => d.code === 'FORGE103')).toBe(true);
    expect(parse('=== k ===\n~ temp t\n').diagnostics.some((d) => d.code === 'FORGE103')).toBe(true);
  });
});

describe('parser: diverts and tunnels (F326)', () => {
  it('parses plain diverts, dotted targets, tunnels, and returns', () => {
    const { story } = parse('=== k ===\n-> a.b\n-> shop ->\n->->\n');
    const items = story.knots[0]?.body.items as DivertLineNode[];
    expect(items[0]?.divert).toMatchObject({ kind: 'Divert', targetPath: ['a', 'b'], tunnel: false });
    expect(items[1]?.divert).toMatchObject({ kind: 'Divert', targetPath: ['shop'], tunnel: true });
    expect(items[2]?.divert.kind).toBe('TunnelReturn');
  });

  it('parses trailing diverts on text lines', () => {
    const { story } = parse('=== k ===\nShe ran. -> away\n');
    const line = story.knots[0]?.body.items[0] as TextLineNode;
    expect(line.segments.map((s) => s.kind)).toEqual(['Text', 'Divert']);
  });

  it('reports diverts without targets (FORGE105)', () => {
    expect(parse('=== k ===\nGo. ->\n').diagnostics.some((d) => d.code === 'FORGE105')).toBe(true);
  });
});

describe('parser: inline conditionals and alternatives (F327)', () => {
  it('parses conditionals with and without else', () => {
    const { story } = parse('=== k ===\nIt is {open: light|dark} here. {late: Hurry.}\n');
    const line = story.knots[0]?.body.items[0] as TextLineNode;
    const conds = line.segments.filter((s) => s.kind === 'InlineConditional');
    expect(conds).toHaveLength(2);
    expect(conds[0]?.elseBranch).toBeDefined();
    expect(conds[1]?.elseBranch).toBeUndefined();
  });

  it('parses sequences, cycles, and shuffles', () => {
    const { story } = parse('=== k ===\n{a|b|c} {&x|y} {~p|q}\n');
    const line = story.knots[0]?.body.items[0] as TextLineNode;
    const alts = line.segments.filter((s) => s.kind === 'Alternative');
    expect(alts.map((a) => a.flavor)).toEqual(['sequence', 'cycle', 'shuffle']);
    expect(alts[0]?.branches).toHaveLength(3);
  });

  it('parses interpolations and nested inline blocks', () => {
    const { story } = parse('=== k ===\nYou have {gold} coins{gold > 1: {&!|!!}}.\n');
    const line = story.knots[0]?.body.items[0] as TextLineNode;
    expect(line.segments.some((s) => s.kind === 'Interpolation')).toBe(true);
    const cond = line.segments.find((s) => s.kind === 'InlineConditional');
    expect(cond?.thenBranch.segments.some((s) => s.kind === 'Alternative')).toBe(true);
  });

  it('rejects three-branch conditionals (FORGE101)', () => {
    const diags = parse('=== k ===\n{x: a|b|c}\n').diagnostics;
    expect(diags.some((d) => d.code === 'FORGE101')).toBe(true);
  });
});

describe('parser: knowledge bindings (F328)', () => {
  it('parses entity refs in text and expressions, and note refs', () => {
    const { story } = parse(
      '=== k ===\n@fox(Reynard).mood greets you near [[The Old Elm]].\n~ temp ok = @fox.health > 3\n',
    );
    const line = story.knots[0]?.body.items[0] as TextLineNode;
    const entity = line.segments.find((s) => s.kind === 'EntityRef');
    expect(entity).toMatchObject({ name: 'fox', displayName: 'Reynard', field: 'mood' });
    expect(line.segments.find((s) => s.kind === 'NoteRef')).toMatchObject({ title: 'The Old Elm' });
    const logic = story.knots[0]?.body.items[1] as LogicLineNode;
    expect(logic.stmt.kind).toBe('TempDecl');
  });
});

describe('parser: error recovery (F329)', () => {
  it('one bad line does not cascade', () => {
    const source = '=== k ===\n~ x = = =\nGood line.\n* Fine choice\n  -> END\n';
    const { story, diagnostics } = parse(source);
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true);
    const items = story.knots[0]?.body.items ?? [];
    expect(items.some((i) => i.kind === 'TextLine')).toBe(true);
    expect(items.some((i) => i.kind === 'Choice')).toBe(true);
  });

  it('recovers from malformed knot headers (FORGE106)', () => {
    const { story, diagnostics } = parse('=== ===\nlost\n=== ok ===\nfound\n');
    expect(diagnostics.some((d) => d.code === 'FORGE106')).toBe(true);
    expect(story.knots.some((k) => k.name.name === 'ok')).toBe(true);
  });

  it('collects multiple errors in one pass (F345)', () => {
    const source = '~ a = +\n~ b = )\n-> \n';
    const codes = parse(source).diagnostics.map((d) => d.code);
    expect(codes.filter((c) => c === 'FORGE102').length).toBeGreaterThanOrEqual(2);
    expect(codes).toContain('FORGE105');
  });
});

describe('parser: golden AST snapshots (F330)', () => {
  it('snapshot: compact weave story', () => {
    const source = [
      '# title: Golden',
      'VAR n = 2',
      '-> top',
      '=== top ===',
      'Hello {n}.',
      '* (a) First [pick] choice. -> top',
      '+ {n > 1} Second',
      '- Done. <> # end',
      '-> END',
      '',
    ].join('\n');
    const { story, diagnostics } = parse(source);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(astToPlainObject(story)).toMatchSnapshot();
  });

  it('snapshot: error-recovery AST keeps healthy siblings', () => {
    const { story } = parse('=== k ===\n~ broken = (\nStill here.\n');
    expect(astToPlainObject(story)).toMatchSnapshot();
  });
});

describe('parser: misc edges', () => {
  it('parses empty sources', () => {
    const { story } = parse('');
    expect(story.knots).toEqual([]);
    expect(errorsOf('')).toEqual([]);
  });

  it('parses files with only comments and blank lines', () => {
    expect(errorsOf('// just a comment\n\n/* block */\n')).toEqual([]);
  });

  it('attaches leading and trailing comments', () => {
    const { story } = parse('// about k\n=== k ===\ntext // trailing\n');
    expect(story.knots[0]?.leadingComments?.[0]?.text).toBe('// about k');
    const line = story.knots[0]?.body.items[0] as TextLineNode;
    expect(line.trailingComment?.text).toBe('// trailing');
  });
});
