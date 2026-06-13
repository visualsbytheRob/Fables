// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { splitHighlights } from './highlight.js';

describe('splitHighlights', () => {
  it('returns the whole text as not-highlighted when no highlights', () => {
    const result = splitHighlights('hello world', []);
    expect(result).toEqual([{ text: 'hello world', highlighted: false }]);
  });

  it('highlights a single range', () => {
    const result = splitHighlights('hello world', [{ start: 6, end: 11 }]);
    expect(result).toEqual([
      { text: 'hello ', highlighted: false },
      { text: 'world', highlighted: true },
    ]);
  });

  it('handles highlight at the start', () => {
    const result = splitHighlights('hello world', [{ start: 0, end: 5 }]);
    expect(result).toEqual([
      { text: 'hello', highlighted: true },
      { text: ' world', highlighted: false },
    ]);
  });

  it('handles multiple non-overlapping highlights', () => {
    const result = splitHighlights('the quick brown fox', [
      { start: 4, end: 9 },
      { start: 16, end: 19 },
    ]);
    expect(result).toEqual([
      { text: 'the ', highlighted: false },
      { text: 'quick', highlighted: true },
      { text: ' brown ', highlighted: false },
      { text: 'fox', highlighted: true },
    ]);
  });

  it('handles a highlight that covers the entire string', () => {
    const result = splitHighlights('hello', [{ start: 0, end: 5 }]);
    expect(result).toEqual([{ text: 'hello', highlighted: true }]);
  });

  it('clamps highlights that exceed text length', () => {
    const result = splitHighlights('hi', [{ start: 0, end: 100 }]);
    expect(result[0]).toEqual({ text: 'hi', highlighted: true });
  });

  it('sorts unsorted highlights', () => {
    const result = splitHighlights('abcdef', [
      { start: 4, end: 6 },
      { start: 0, end: 2 },
    ]);
    expect(result[0]).toEqual({ text: 'ab', highlighted: true });
    expect(result[1]).toEqual({ text: 'cd', highlighted: false });
    expect(result[2]).toEqual({ text: 'ef', highlighted: true });
  });
});
