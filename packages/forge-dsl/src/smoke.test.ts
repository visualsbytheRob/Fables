import { describe, expect, it } from 'vitest';
// Deliberately import through the package barrel so the public surface is exercised.
import {
  compile,
  computeLineStarts,
  f,
  format,
  isExprNode,
  mergeSpans,
  offsetToPosition,
  parse,
  pointSpan,
  pos,
  printStory,
  span,
  spanContains,
  spansOverlap,
  spanText,
} from './index.js';

const SAMPLE = `# title: The Fox and the Crow
# author: Aesop

VAR cunning = 3
CONST prize = "cheese"

The wood smelled of rain. // scene-setting
-> meeting

=== meeting ===
A crow sat on a branch with a piece of {prize} in her beak.
* (flatter) "What a beautiful voice you must have!"
  The crow puffed up her chest. {cunning > 2: She suspects nothing.|She eyes you warily.}
  ** "Sing for me!" [] The crow opens her beak. -> drop ->
* {cunning > 1} (sneak) Wait quietly [and watch] and watch the branch.
  -> waiting
+ Walk away. # quiet ending
  -> END
- (after) The forest hums. {&Wind stirs.|Leaves fall.|A twig snaps.}
-> waiting

=== waiting ===
Time passes. <>
The cheese {~falls|stays put|wobbles}.
~ cunning = cunning + 1
-> meeting.after

=== drop ===
The cheese tumbles down!
->->
`;

describe('public API smoke (compile pipeline, F399)', () => {
  it('compiles the sample cleanly through tokenize → parse → resolve → check', () => {
    const result = compile(SAMPLE, { fileName: 'sample.fable' });
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.ast.knots.map((k) => k.name.name)).toEqual(['meeting', 'waiting', 'drop']);
    expect(result.symbols.knots.size).toBe(3);
  });

  it('round-trips through the printer', () => {
    const { story } = parse(SAMPLE);
    const printed = printStory(story);
    const reparsed = parse(printed);
    expect(reparsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(printStory(reparsed.story)).toBe(printed);
  });

  it('format is idempotent on the sample', () => {
    const once = format(SAMPLE).formatted;
    expect(format(once).formatted).toBe(once);
  });
});

describe('span utilities (F334 public surface)', () => {
  it('builds, merges, and compares spans', () => {
    const a = span(pos(1, 1, 0), pos(1, 5, 4));
    const b = span(pos(1, 4, 3), pos(2, 2, 10));
    const merged = mergeSpans(a, b);
    expect(merged.start.offset).toBe(0);
    expect(merged.end.offset).toBe(10);
    expect(spanContains(merged, a)).toBe(true);
    expect(spanContains(a, merged)).toBe(false);
    expect(spansOverlap(a, b)).toBe(true);
    expect(spansOverlap(a, span(pos(3, 1, 20), pos(3, 2, 21)))).toBe(false);
    const point = pointSpan(pos(1, 1, 0));
    expect(point.start).toEqual(point.end);
  });

  it('converts offsets to positions via line starts', () => {
    const source = 'ab\ncd\nef';
    const starts = computeLineStarts(source);
    expect(starts).toEqual([0, 3, 6]);
    expect(offsetToPosition(0, starts)).toEqual({ line: 1, col: 1, offset: 0 });
    expect(offsetToPosition(4, starts)).toEqual({ line: 2, col: 2, offset: 4 });
    expect(offsetToPosition(7, starts)).toEqual({ line: 3, col: 2, offset: 7 });
    expect(spanText(source, span(pos(2, 1, 3), pos(2, 3, 5)))).toBe('cd');
  });
});

describe('node guards', () => {
  it('isExprNode distinguishes expressions from structure', () => {
    expect(isExprNode(f.lit(1))).toBe(true);
    expect(isExprNode(f.varRef('x'))).toBe(true);
    expect(isExprNode(f.binary('+', f.lit(1), f.lit(2)))).toBe(true);
    expect(isExprNode(f.text('prose'))).toBe(false);
    expect(isExprNode(f.knot('k'))).toBe(false);
  });
});
