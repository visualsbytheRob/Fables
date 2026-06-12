import { compile } from '@fables/forge-dsl';
import { describe, expect, it } from 'vitest';
import { definitionAt, resolveTargetPath } from './definition.js';

const STORY = `VAR hunger = 3

-> den

=== den ===
The fox curls up.
~ temp warmth = hunger + 1
{warmth > 2: Snug.}
* Sleep. -> den.exit
+ Wait. -> exit

= exit
Out you go. Visits: {den}.
-> morning

=== morning ===
Sunlight.
-> END
`;

const result = compile(STORY);

describe('forge go-to-definition (F385)', () => {
  it('resolves a divert to the knot declaration', () => {
    const def = definitionAt(result, STORY.indexOf('-> den') + 4);
    expect(def?.kind).toBe('knot');
    expect(def?.name).toBe('den');
    expect(def?.span.start.offset).toBe(STORY.indexOf('den ==='));
  });

  it('resolves dotted and relative diverts to the stitch declaration', () => {
    const dotted = definitionAt(result, STORY.indexOf('den.exit') + 5);
    expect(dotted?.kind).toBe('stitch');
    expect(dotted?.span.start.offset).toBe(STORY.indexOf('= exit') + 2);
    const relative = definitionAt(result, STORY.indexOf('-> exit') + 4);
    expect(relative?.span.start.offset).toBe(STORY.indexOf('= exit') + 2);
  });

  it('resolves variable references to VAR declarations', () => {
    const def = definitionAt(result, STORY.indexOf('hunger + 1'));
    expect(def?.kind).toBe('variable');
    expect(def?.span.start.offset).toBe(STORY.indexOf('hunger'));
  });

  it('resolves temp references within their knot scope', () => {
    const def = definitionAt(result, STORY.indexOf('warmth > 2'));
    expect(def?.kind).toBe('temp');
    expect(def?.span.start.offset).toBe(STORY.indexOf('warmth'));
  });

  it('resolves read counts to the target declaration', () => {
    const def = definitionAt(result, STORY.indexOf('{den}.') + 1);
    expect(def?.kind).toBe('knot');
    expect(def?.span.start.offset).toBe(STORY.indexOf('den ==='));
  });

  it('returns undefined over plain prose and unknown targets', () => {
    expect(definitionAt(result, STORY.indexOf('curls'))).toBeUndefined();
    const broken = compile('-> nowhere\n');
    expect(definitionAt(broken, 4)).toBeUndefined();
  });

  it('resolveTargetPath prefers absolute paths, then knot- and stitch-relative', () => {
    expect(resolveTargetPath(result, ['den'], 0)?.fullPath).toBe('den');
    const inDen = STORY.indexOf('curls');
    expect(resolveTargetPath(result, ['exit'], inDen)?.fullPath).toBe('den.exit');
    expect(resolveTargetPath(result, ['exit'], 0)).toBeUndefined();
  });
});
