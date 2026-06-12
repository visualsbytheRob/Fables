import { compile } from '@fables/forge-dsl';
import { describe, expect, it } from 'vitest';
import { identifierInSpan, renameAt, type RenameEdit } from './rename.js';

const STORY = `VAR hunger = 3

-> den

=== den ===
The fox curls up. Hunger is {hunger}.
~ hunger = hunger - 1
~ temp warmth = 2
{warmth > 1: Cosy.}
* Sleep until dawn.
  -> den.exit
+ Stay awake.
  -> exit

= exit
You have left {den} time{den == 1: |s}.
-> morning

=== morning ===
~ temp warmth = 9
Warmth: {warmth}.
-> END
`;

const apply = (source: string, edits: readonly RenameEdit[]): string => {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  }
  return out;
};

const plan = (source: string, offset: number, newName: string) =>
  renameAt(compile(source), source, offset, newName);

describe('forge rename refactor (F388)', () => {
  it('renames a knot: header, diverts, dotted targets, and read counts', () => {
    const outcome = plan(STORY, STORY.indexOf('den ==='), 'burrow');
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.kind).toBe('knot');
    const next = apply(STORY, outcome.edits);
    expect(next).toContain('=== burrow ===');
    expect(next).toContain('-> burrow\n');
    expect(next).toContain('-> burrow.exit');
    expect(next).toContain('{burrow} time{burrow == 1: |s}');
    expect(next).not.toMatch(/\bden\b/);
    // the rename round-trips: the renamed story still compiles cleanly
    expect(compile(next).ok).toBe(compile(STORY).ok);
  });

  it('renames a stitch from its declaration, fixing dotted and local diverts', () => {
    const outcome = plan(STORY, STORY.indexOf('= exit') + 2, 'doorway');
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.kind).toBe('stitch');
    const next = apply(STORY, outcome.edits);
    expect(next).toContain('= doorway');
    expect(next).toContain('-> den.doorway');
    expect(next).toContain('-> doorway\n');
  });

  it('renames a stitch from a reference site too', () => {
    const outcome = plan(STORY, STORY.indexOf('den.exit') + 5, 'doorway');
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.kind).toBe('stitch');
    expect(apply(STORY, outcome.edits)).toContain('= doorway');
  });

  it('renames a global variable everywhere: decl, assigns, reads, interpolations', () => {
    const outcome = plan(STORY, STORY.indexOf('VAR hunger') + 4, 'appetite');
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.kind).toBe('variable');
    const next = apply(STORY, outcome.edits);
    expect(next).toContain('VAR appetite = 3');
    expect(next).toContain('~ appetite = appetite - 1');
    expect(next).toContain('{appetite}');
    expect(next).not.toMatch(/\bhunger\b/);
  });

  it('renames a temp only inside its own knot', () => {
    const outcome = plan(STORY, STORY.indexOf('temp warmth') + 5, 'heat');
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.kind).toBe('temp');
    const next = apply(STORY, outcome.edits);
    expect(next).toContain('~ temp heat = 2');
    expect(next).toContain('{heat > 1: Cosy.}');
    // morning's unrelated temp of the same name is untouched
    expect(next).toContain('~ temp warmth = 9');
    expect(next).toContain('Warmth: {warmth}.');
  });

  it('rejects invalid identifiers and name collisions', () => {
    const knotOffset = STORY.indexOf('den ===');
    expect(plan(STORY, knotOffset, 'not an ident')).toMatchObject({ ok: false });
    expect(plan(STORY, knotOffset, 'morning')).toMatchObject({ ok: false });
    // a global may not take a name any temp already uses (it would shadow-collide)
    expect(plan(STORY, STORY.indexOf('VAR hunger') + 4, 'warmth')).toMatchObject({ ok: false });
    expect(plan(STORY, STORY.indexOf('temp warmth') + 5, 'hunger')).toMatchObject({ ok: false });
  });

  it('reports when there is nothing to rename', () => {
    expect(plan(STORY, STORY.indexOf('curls'), 'x')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('no renameable symbol'),
    });
  });

  it('identifierInSpan finds dotted path segments regardless of spacing', () => {
    const source = '-> den . exit';
    const span = {
      start: { line: 1, col: 1, offset: 0 },
      end: { line: 1, col: 14, offset: 13 },
    };
    expect(identifierInSpan(source, span, 0)).toMatchObject({ from: 3, to: 6 });
    expect(identifierInSpan(source, span, 1)).toMatchObject({ from: 9, to: 13 });
    expect(identifierInSpan(source, span, 2)).toBeNull();
  });
});
