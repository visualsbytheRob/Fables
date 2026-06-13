/** Story-wide search & replace tests (F516). */
import { describe, expect, it } from 'vitest';
import { replaceInFiles, searchFiles } from './search.js';

const files = new Map([
  ['main.fable', '-> den\n\n=== den ===\nThe Fox waits for the fox.\n-> END\n'],
  ['side.fable', '=== extra ===\nA fox passes by.\n-> END\n'],
]);

describe('searchFiles', () => {
  it('finds matches across files, case-insensitive by default', () => {
    const matches = searchFiles(files, 'fox');
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.path)).toEqual(['main.fable', 'main.fable', 'side.fable']);
    expect(matches[0]?.line).toBe(4);
    expect(matches[0]?.lineText).toContain('Fox waits');
  });

  it('respects case sensitivity', () => {
    expect(searchFiles(files, 'Fox', { caseSensitive: true })).toHaveLength(1);
  });

  it('supports regex mode and rejects invalid patterns gracefully', () => {
    const matches = searchFiles(files, 'f(o)x', { regex: true });
    expect(matches).toHaveLength(3);
    expect(searchFiles(files, '(((', { regex: true })).toEqual([]);
  });

  it('treats special characters literally outside regex mode', () => {
    expect(searchFiles(files, 'f(o)x')).toEqual([]);
  });
});

describe('replaceInFiles', () => {
  it('replaces everywhere and only returns changed files', () => {
    const changed = replaceInFiles(files, 'fox', 'badger');
    expect([...changed.keys()].sort()).toEqual(['main.fable', 'side.fable']);
    expect(changed.get('main.fable')).toContain('The badger waits for the badger.');
    expect(replaceInFiles(files, 'wolverine', 'x').size).toBe(0);
  });

  it('supports regex capture groups in replacements', () => {
    const changed = replaceInFiles(files, '(f)ox', '$1OX', { regex: true });
    expect(changed.get('side.fable')).toContain('A fOX passes by.');
  });
});
