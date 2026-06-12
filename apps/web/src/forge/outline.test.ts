import { compile } from '@fables/forge-dsl';
import { describe, expect, it } from 'vitest';
import { extractOutline, outlineFromResult } from './outline.js';

const STORY = `-> palace

=== palace ===
The lion's palace is a sun-warmed rock.
* (petition) Plead your case.
  -> palace
+ Slink away.
  -> gardens

= throne
He receives visitors here.
- (received) The audience ends.
-> gardens

=== gardens ===
Peacocks scream at nothing.
-> END
`;

describe('forge outline extraction (F387)', () => {
  it('builds the knots → stitches tree with labels in document order', () => {
    const outline = extractOutline(compile(STORY).ast);
    expect(outline.map((e) => e.name)).toEqual(['palace', 'gardens']);
    const palace = outline[0];
    expect(palace?.kind).toBe('knot');
    expect(palace?.children.map((c) => `${c.kind}:${c.name}`)).toEqual([
      'label:petition',
      'stitch:throne',
    ]);
    const throne = palace?.children[1];
    expect(throne?.children.map((c) => `${c.kind}:${c.name}`)).toEqual(['label:received']);
    expect(outline[1]?.children).toEqual([]);
  });

  it('records name offsets and lines for navigation', () => {
    const outline = extractOutline(compile(STORY).ast);
    const palace = outline[0];
    expect(palace?.offset).toBe(STORY.indexOf('palace ==='));
    expect(palace?.line).toBe(3);
    const petition = palace?.children[0];
    expect(petition?.offset).toBe(STORY.indexOf('petition'));
  });

  it('returns an empty outline for a story without knots', () => {
    expect(extractOutline(compile('Just a single line of prose.\n').ast)).toEqual([]);
  });

  it('outlineFromResult is a thin alias over the AST', () => {
    const result = compile(STORY);
    expect(outlineFromResult(result)).toEqual(extractOutline(result.ast));
  });
});
