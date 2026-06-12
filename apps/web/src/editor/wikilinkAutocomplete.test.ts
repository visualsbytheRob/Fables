import { describe, expect, it } from 'vitest';
import {
  wikilinkCompletionSource,
  type WikilinkCompletionContext,
} from './wikilinkAutocomplete.js';

const ctx = (textBefore: string): WikilinkCompletionContext => ({
  explicit: false,
  matchBefore(expr: RegExp) {
    const match = expr.exec(textBefore);
    if (!match) return null;
    const from = textBefore.length - match[0].length;
    return { from, to: textBefore.length, text: match[0] };
  },
});

const source = wikilinkCompletionSource(() => [
  'Alpha',
  'Alpha Beta',
  'Gamma',
  'beta notes',
  '',
  'Alpha', // duplicate title
]);

describe('wikilink autocomplete (F203)', () => {
  it('completes after [[ with prefix matches ranked first', () => {
    const result = source(ctx('see [[al'));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toEqual(['Alpha', 'Alpha Beta']);
    expect(result!.from).toBe(4);
  });

  it('inserts the full [[Title]] syntax', () => {
    const result = source(ctx('[[gam'))!;
    expect(result.options[0]!.apply).toBe('[[Gamma]]');
  });

  it('offers every title (deduplicated, no blanks) right after [[', () => {
    const result = source(ctx('[['))!;
    expect(result.options.map((o) => o.label)).toEqual([
      'Alpha',
      'Alpha Beta',
      'Gamma',
      'beta notes',
    ]);
  });

  it('ranks substring matches after prefix matches', () => {
    const result = source(ctx('[[beta'))!;
    expect(result.options.map((o) => o.label)).toEqual(['beta notes', 'Alpha Beta']);
  });

  it('returns null without a [[ trigger or when nothing matches', () => {
    expect(source(ctx('plain text'))).toBeNull();
    expect(source(ctx('[x'))).toBeNull();
    expect(source(ctx('[[zzz'))).toBeNull();
  });
});
