import { compile } from '@fables/forge-dsl';
import { describe, expect, it } from 'vitest';
import { hoverInfoAt, simpleTypeOf } from './hover.js';

const STORY = `VAR hunger = 3
VAR name = "Reynard"
VAR keys = ["brass", "bone"]
VAR is_winter = false

-> den

=== den ===
The fox curls up tight.
~ temp warmth = hunger + 1
{warmth}
* Sleep. -> morning
+ Wait. @owl(Strix).mood watches. See [[The Night-Wood]].
  -> den

= deeper
Further in. Visits: {den}.
-> morning

=== morning ===
Sunlight.
-> END
`;

const result = compile(STORY);
const hover = (offset: number) => hoverInfoAt(result, offset);

describe('forge hover info (F386)', () => {
  it('shows declaration kind, type and initializer for globals', () => {
    const info = hover(STORY.indexOf('hunger + 1'));
    expect(info?.lines[0]).toBe('VAR hunger: number');
    expect(info?.lines[1]).toBe('= 3');
    const str = hover(STORY.indexOf('name') + 1);
    expect(str?.lines[0]).toBe('VAR name: string');
  });

  it('shows temp type within its knot', () => {
    const info = hover(STORY.indexOf('{warmth}') + 2);
    expect(info?.lines[0]).toBe('temp warmth: number');
  });

  it('summarizes the target knot for diverts', () => {
    const info = hover(STORY.indexOf('-> morning') + 4);
    expect(info?.lines[0]).toBe('=== morning ===');
    expect(info?.lines[1]).toContain('0 stitches');
    expect(info?.lines).toContain('Sunlight.');
  });

  it('summarizes knots used as read counts', () => {
    const info = hover(STORY.indexOf('{den}.') + 1);
    expect(info?.lines[0]).toBe('=== den ===');
    expect(info?.lines.at(-1)).toContain('read count');
  });

  it('explains END diverts and knowledge bindings', () => {
    expect(hover(STORY.indexOf('-> END') + 4)?.lines[0]).toBe('-> END');
    const entity = hover(STORY.indexOf('@owl') + 2);
    expect(entity?.lines[0]).toBe('@owl.mood');
    expect(entity?.lines[1]).toContain('entity');
    const note = hover(STORY.indexOf('The Night-Wood'));
    expect(note?.lines[0]).toBe('[[The Night-Wood]]');
  });

  it('returns null over plain prose', () => {
    expect(hover(STORY.indexOf('curls'))).toBeNull();
  });
});

describe('simpleTypeOf', () => {
  const typeOf = (name: string) => {
    const decl = result.symbols.globals.get(name);
    if (decl === undefined) throw new Error(`no global ${name}`);
    return simpleTypeOf(decl.init);
  };

  it('types literals and lists from initializers', () => {
    expect(typeOf('hunger')).toBe('number');
    expect(typeOf('name')).toBe('string');
    expect(typeOf('keys')).toBe('list');
    expect(typeOf('is_winter')).toBe('bool');
  });

  it('types arithmetic, comparisons and builtin calls', () => {
    const r = compile('VAR a = 1 + 2\nVAR b = 1 < 2\nVAR c = RANDOM(1, 6)\n{a}{b}{c}\n-> END\n');
    const init = (n: string) => r.symbols.globals.get(n)?.init;
    expect(simpleTypeOf(init('a')!)).toBe('number');
    expect(simpleTypeOf(init('b')!)).toBe('bool');
    expect(simpleTypeOf(init('c')!)).toBe('number');
  });
});
