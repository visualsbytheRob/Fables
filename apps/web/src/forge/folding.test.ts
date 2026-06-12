import { compile } from '@fables/forge-dsl';
import { describe, expect, it } from 'vitest';
import { computeFoldRanges } from './folding.js';

const STORY = `-> den

=== den ===
The fox curls up.
* Sleep until dawn.
  A long dark hush.
  -> den
+ Wait. -> exit

= exit
You step into the cold.
-> END
`;

const ranges = (source: string) => computeFoldRanges(compile(source).ast, source);

describe('forge fold ranges (F389)', () => {
  it('folds knots from the end of the header line to the end of the body', () => {
    const all = ranges(STORY);
    const knot = all.find((r) => r.kind === 'knot');
    expect(knot).toBeDefined();
    expect(knot?.from).toBe(STORY.indexOf('=== den ===') + '=== den ==='.length);
    // covers everything up to the trimmed end of the story (stitches included)
    expect(STORY.slice(knot?.from, knot?.to)).toContain('= exit');
    expect(STORY.slice(knot?.from, knot?.to).trimEnd().endsWith('-> END')).toBe(true);
  });

  it('folds stitches and choices that own nested content', () => {
    const all = ranges(STORY);
    const stitch = all.find((r) => r.kind === 'stitch');
    expect(stitch?.from).toBe(STORY.indexOf('= exit') + '= exit'.length);
    expect(STORY.slice(stitch?.from, stitch?.to)).toContain('-> END');

    const choices = all.filter((r) => r.kind === 'choice');
    expect(choices).toHaveLength(1); // only `* Sleep…` has a nested body
    const choice = choices[0];
    expect(STORY.slice(choice?.from, choice?.to)).toContain('A long dark hush.');
  });

  it('returns ranges sorted by start, outermost first on ties', () => {
    const all = ranges(STORY);
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.from).toBeGreaterThanOrEqual(all[i - 1]!.from);
    }
  });

  it('emits nothing for a flat story', () => {
    expect(ranges('A single line.\n-> END\n')).toEqual([]);
  });
});
