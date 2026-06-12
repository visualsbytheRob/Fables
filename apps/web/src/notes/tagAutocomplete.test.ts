import { describe, expect, it } from 'vitest';
import { tagCompletionSource, type TagCompletionContext } from './tagAutocomplete.js';

const ctx = (textBefore: string, explicit = false): TagCompletionContext => ({
  explicit,
  matchBefore(expr: RegExp) {
    const match = expr.exec(textBefore);
    if (!match) return null;
    const from = textBefore.length - match[0].length;
    return { from, to: textBefore.length, text: match[0] };
  },
});

const source = tagCompletionSource(() => ['world', 'world/characters', 'plot', 'magic']);

describe('tag autocomplete (F153)', () => {
  it('completes after # with prefix filtering', () => {
    const result = source(ctx('some text #wo'));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toEqual(['#world', '#world/characters']);
    expect(result!.from).toBe(10);
  });

  it('offers all tags right after a bare #', () => {
    expect(source(ctx('#'))!.options).toHaveLength(4);
  });

  it('matches nested segments after the slash', () => {
    const result = source(ctx('#characters'));
    expect(result!.options.map((o) => o.label)).toEqual(['#world/characters']);
  });

  it('returns null without a # trigger or with no matches', () => {
    expect(source(ctx('plain text'))).toBeNull();
    expect(source(ctx('#zzz'))).toBeNull();
  });
});
