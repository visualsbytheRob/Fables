/** Lore reference extraction tests (F628). */
import { describe, expect, it } from 'vitest';
import { entityRefKey, entityRefLabel, extractLoreRefs } from './loreRefs.js';

describe('extractLoreRefs (F628)', () => {
  it('collects note embeds and entity refs from prose', () => {
    const src = `=== meeting ===
@Fox(Reynard) eyes the cheese. See [[The Trial of Reynard]].
The crow's @Crow.cunning is no match.
-> END
`;
    const refs = extractLoreRefs(src);
    expect(refs.notes).toEqual(['The Trial of Reynard']);
    expect(refs.entities).toEqual([
      { name: 'Fox', field: null },
      { name: 'Crow', field: 'cunning' },
    ]);
  });

  it('dedupes repeated refs but keeps field variants distinct', () => {
    const src = '@Fox flatters. @Fox again. @Fox.cunning rises. [[Pride]] and [[Pride]].';
    const refs = extractLoreRefs(src);
    expect(refs.notes).toEqual(['Pride']);
    expect(refs.entities).toEqual([
      { name: 'Fox', field: null },
      { name: 'Fox', field: 'cunning' },
    ]);
  });

  it('records the first-occurrence offset of each ref', () => {
    const src = 'one\n@Fox here\n[[Note]] there\n';
    const refs = extractLoreRefs(src);
    expect(refs.offsets.get('entity:@Fox')).toBe(src.indexOf('@Fox'));
    expect(refs.offsets.get('note:Note')).toBe(src.indexOf('[[Note]]'));
  });

  it('ignores refs inside line and block comments', () => {
    const src = `Live @Fox and [[Real]].
// commented @Ghost and [[Fake]]
/* @Phantom [[AlsoFake]] */
-> END
`;
    const refs = extractLoreRefs(src);
    expect(refs.entities).toEqual([{ name: 'Fox', field: null }]);
    expect(refs.notes).toEqual(['Real']);
  });

  it('returns empty structures for prose without refs', () => {
    const refs = extractLoreRefs('Just plain words.\n-> END\n');
    expect(refs.notes).toEqual([]);
    expect(refs.entities).toEqual([]);
    expect(refs.offsets.size).toBe(0);
  });

  it('trims note titles and skips empty ones', () => {
    const refs = extractLoreRefs('See [[  Spaced Title  ]] but not [[]].');
    expect(refs.notes).toEqual(['Spaced Title']);
  });

  it('keys and labels entity refs consistently', () => {
    expect(entityRefKey({ name: 'Fox', field: null })).toBe('@Fox');
    expect(entityRefKey({ name: 'Crow', field: 'cunning' })).toBe('@Crow.cunning');
    expect(entityRefLabel({ name: 'Lion', field: 'pride' })).toBe('@Lion.pride');
  });
});
