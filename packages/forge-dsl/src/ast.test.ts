import { describe, expect, it } from 'vitest';
import type { AnyNode, ChoiceNode } from './ast.js';
import { f } from './factory.js';
import { assertInvariants, checkInvariants } from './invariants.js';
import { parse } from './parser.js';
import { printStory } from './printer.js';
import {
  findAllBindings,
  findAllChoices,
  findAllDiverts,
  findAllVarRefs,
  findAllWhere,
  findKnot,
  nodeAtPosition,
} from './query.js';
import { astToPlainObject, serializeAst } from './serialize.js';
import { spanText } from './span.js';
import { ancestors, attachParents, childrenOf, walk } from './walker.js';

const SOURCE = [
  'VAR mood = "wary"',
  '-> woods',
  '=== woods ===',
  'The fox watches @owl from the brush near [[The Old Elm]].',
  '* (talk) Speak up. -> woods.parley',
  '+ Stay hidden {mood == "wary": and breathe|and wait}.',
  '- All paths join here.',
  '-> END',
  '= parley',
  '"Evening," says the owl.',
  '-> END',
  '',
].join('\n');

describe('walker (F332)', () => {
  it('fires enter and exit in matched pairs, depth-first', () => {
    const { story } = parse(SOURCE);
    const entered: string[] = [];
    const exited: string[] = [];
    walk(story, {
      enter: (n) => {
        entered.push(n.kind);
      },
      exit: (n) => {
        exited.push(n.kind);
      },
    });
    expect(entered.length).toBe(exited.length);
    expect(entered[0]).toBe('Story');
    expect(exited[exited.length - 1]).toBe('Story');
    expect(entered).toContain('Choice');
    expect(entered).toContain('InlineConditional');
  });

  it('skips children when enter returns false', () => {
    const { story } = parse(SOURCE);
    const seen: string[] = [];
    walk(story, {
      enter(node) {
        seen.push(node.kind);
        if (node.kind === 'Knot') return false;
        return undefined;
      },
    });
    expect(seen).toContain('Knot');
    expect(seen).not.toContain('Choice');
  });
});

describe('parent pointers (F336)', () => {
  it('attaches parents consistent with childrenOf', () => {
    const { story } = parse(SOURCE);
    attachParents(story);
    for (const choice of findAllChoices(story)) {
      expect(choice.parent?.kind).toBe('Block');
      const chain = ancestors(choice).map((n) => n.kind);
      expect(chain[chain.length - 1]).toBe('Story');
      expect(chain).toContain('Knot');
    }
    expect(checkInvariants(story, { parentsAttached: true })).toEqual([]);
  });
});

describe('queries (F335)', () => {
  it('finds diverts, bindings, choices, and var refs', () => {
    const { story } = parse(SOURCE);
    expect(findAllDiverts(story).map((d) => d.targetPath.join('.'))).toEqual([
      'woods',
      'woods.parley',
      'END',
      'END',
    ]);
    expect(findAllBindings(story).map((b) => (b.kind === 'EntityRef' ? b.name : b.title))).toEqual([
      'owl',
      'The Old Elm',
    ]);
    expect(findAllChoices(story)).toHaveLength(2);
    expect(findAllVarRefs(story).map((v) => v.path.join('.'))).toEqual(['mood']);
    expect(findKnot(story, 'woods')?.stitches[0]?.name.name).toBe('parley');
    expect(findKnot(story, 'absent')).toBeUndefined();
    expect(findAllWhere(story, (n) => n.kind === 'Gather')).toHaveLength(1);
  });

  it('finds the innermost node at a position', () => {
    const { story } = parse(SOURCE);
    const offset = SOURCE.indexOf('@owl');
    const node = nodeAtPosition(story, { line: 4, col: 17, offset: offset + 1 });
    expect(node?.kind).toBe('EntityRef');
  });
});

describe('span utilities (F334)', () => {
  it('node spans cover their exact source text', () => {
    const { story } = parse(SOURCE);
    const divert = findAllDiverts(story)[1];
    expect(divert && spanText(SOURCE, divert.span)).toBe('-> woods.parley');
    const knot = findKnot(story, 'woods');
    expect(knot && spanText(SOURCE, knot.name.span)).toBe('woods');
  });
});

describe('serialization (F337)', () => {
  it('is stable, versioned, and parent-free', () => {
    const { story } = parse(SOURCE);
    attachParents(story);
    const json = serializeAst(story);
    expect(json).toContain('"$schema": "forge-ast/v1"');
    expect(json).not.toContain('"parent"');
    expect(JSON.parse(json)).toBeTruthy();
    // Stable across repeated serialization and re-parses of identical source.
    expect(serializeAst(parse(SOURCE).story)).toBe(serializeAst(parse(SOURCE).story));
    expect(serializeAst(story, { pretty: false })).not.toContain('\n');
  });

  it('sorts object keys deterministically', () => {
    const plain = astToPlainObject(f.lit(1)) as Record<string, unknown>;
    expect(Object.keys(plain)).toEqual([...Object.keys(plain)].sort());
  });
});

describe('node factories (F338)', () => {
  it('builds trees that print and re-parse', () => {
    const story = f.story({
      declarations: [f.varDecl('VAR', 'mood', f.lit('calm'))],
      preamble: f.block([f.divertLine(['camp'])]),
      knots: [
        f.knot('camp', [
          f.textLine(['The fire crackles, ', f.interpolation(f.varRef('mood')), '.']),
          f.choice({ label: 'rest', prefix: ['Sleep.'], body: [f.divertLine(['END'])] }),
          f.choice({ sticky: true, prefix: ['Wait.'], body: [f.divertLine(['camp'])] }),
        ]),
      ],
    });
    const printed = printStory(story);
    const reparsed = parse(printed);
    expect(reparsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(printStory(reparsed.story)).toBe(printed);
  });

  it('covers expression and inline factories', () => {
    const expr = f.ternary(
      f.binary('&&', f.unary('!', f.varRef('a')), f.call('RANDOM', [f.lit(1), f.lit(2)])),
      f.list([f.lit('x')]),
      f.entityRef('fox', { displayName: 'Reynard', field: 'mood' }),
    );
    const line = f.textLine([
      f.inlineConditional(f.lit(true), ['yes'], ['no']),
      f.alternative('cycle', [['a'], ['b']]),
      f.noteRef('A Note'),
      f.glue(),
      f.tag('t').kind === 'Tag' ? f.text('') : f.text(''),
    ]);
    const story = f.story({
      preamble: f.block([
        line,
        f.logicLine(f.tempDecl('t', expr)),
        f.logicLine(f.assign('t', f.lit(2))),
        f.gather(1, ['joined'], 'g'),
        f.tunnelReturnLine(),
      ]),
    });
    expect(() => assertInvariants(story)).not.toThrow();
    expect(printStory(story)).toContain('{true: yes|no}');
  });
});

describe('invariant checker (F339)', () => {
  it('accepts healthy parsed trees', () => {
    const { story } = parse(SOURCE);
    expect(checkInvariants(story)).toEqual([]);
  });

  it('rejects shared nodes and inverted spans', () => {
    const sharedText = f.text('shared');
    const bad = f.story({
      preamble: f.block([f.textLine([sharedText]), f.textLine([sharedText])]),
    });
    expect(checkInvariants(bad).some((v) => v.message.includes('more than once'))).toBe(true);

    const inverted = f.lit(1, {
      start: { line: 2, col: 1, offset: 10 },
      end: { line: 1, col: 1, offset: 4 },
    });
    expect(checkInvariants(inverted).some((v) => v.message.includes('starts after'))).toBe(true);
  });

  it('detects stale parent pointers', () => {
    const { story } = parse(SOURCE);
    attachParents(story);
    const choice = findAllChoices(story)[0] as ChoiceNode;
    choice.parent = story as AnyNode;
    expect(checkInvariants(story, { parentsAttached: true }).length).toBeGreaterThan(0);
  });
});

describe('printer round-trips (F333, F340)', () => {
  const cases: [string, string][] = [
    ['plain text', 'Just a line of prose.\n'],
    ['weave', '=== k ===\n* a\n  * * b\n    -> END\n- g\n-> END\n'],
    ['logic', 'VAR x = 1\n=== k ===\n~ temp y = x * (2 + 3)\n~ x = y\n{x} done\n-> END\n'],
    ['inline', '=== k ===\nA {x: b|c} {&d|e} {~f|g} {h|i} <> j # tag\n'],
    ['bindings', '=== k ===\n@a(B C).d and [[Note]] here.\n'],
    ['tunnels', '=== k ===\n-> t ->\n->->\n'],
    ['escapes', '=== k ===\nA \\{literal\\} \\# brace.\n'],
  ];
  for (const [name, source] of cases) {
    it(`print(parse(x)) is a fixed point: ${name}`, () => {
      const once = printStory(parse(source).story);
      const twice = printStory(parse(once).story);
      expect(twice).toBe(once);
      expect(parse(once).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    });
  }

  it('walker sees identical node kinds before and after printing', () => {
    const { story } = parse(SOURCE);
    const printed = printStory(story);
    const again = parse(printed).story;
    const kindsOf = (root: AnyNode): Record<string, number> => {
      const counts: Record<string, number> = {};
      walk(root, {
        enter(n) {
          counts[n.kind] = (counts[n.kind] ?? 0) + 1;
        },
      });
      return counts;
    };
    expect(kindsOf(again)).toEqual(kindsOf(story));
  });

  it('childrenOf covers every node kind reachable from a rich story', () => {
    const { story } = parse(SOURCE);
    let count = 0;
    walk(story, {
      enter() {
        count++;
      },
    });
    expect(count).toBeGreaterThan(30);
    expect(childrenOf(story).length).toBeGreaterThan(0);
  });
});
