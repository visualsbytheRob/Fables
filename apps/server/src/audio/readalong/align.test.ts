/**
 * Read-along alignment tests (F1642/F1647/F1646/F1650).
 */

import { describe, expect, it } from 'vitest';
import {
  alignmentFromBoundaries,
  estimateAlignment,
  timeOfWord,
  tokenizeWords,
  wordAtTime,
} from './align.js';

describe('tokenizeWords', () => {
  it('keeps word character spans', () => {
    const raw = tokenizeWords('hello  world');
    expect(raw).toHaveLength(2);
    expect(raw[0]).toMatchObject({ word: 'hello', charStart: 0, charEnd: 5 });
    expect(raw[1]).toMatchObject({ word: 'world', charStart: 7, charEnd: 12 });
  });
});

describe('estimateAlignment (F1647)', () => {
  it('spans exactly the total duration, contiguous and ordered', () => {
    const a = estimateAlignment('The quick brown fox', 4000);
    expect(a.words).toHaveLength(4);
    expect(a.words[0]!.startMs).toBe(0);
    expect(a.words[a.words.length - 1]!.endMs).toBe(4000);
    expect(a.totalMs).toBe(4000);
    // Contiguous: each word starts where the previous ended.
    for (let i = 1; i < a.words.length; i++) {
      expect(a.words[i]!.startMs).toBe(a.words[i - 1]!.endMs);
    }
  });

  it('gives longer words more time', () => {
    const a = estimateAlignment('a elephant', 1000);
    const aDur = a.words[0]!.endMs - a.words[0]!.startMs;
    const elephantDur = a.words[1]!.endMs - a.words[1]!.startMs;
    expect(elephantDur).toBeGreaterThan(aDur);
  });

  it('handles empty text', () => {
    const a = estimateAlignment('   ', 1000);
    expect(a.words).toHaveLength(0);
    expect(a.sentences).toHaveLength(0);
  });

  it('splits sentences on terminators', () => {
    const a = estimateAlignment('Hello there. How are you?', 5000);
    expect(a.sentences).toHaveLength(2);
    expect(a.sentences[0]!.text).toBe('Hello there.');
    expect(a.sentences[1]!.wordStart).toBe(2);
  });
});

describe('alignmentFromBoundaries (F1642)', () => {
  it('uses engine boundaries and interpolates gaps', () => {
    const a = alignmentFromBoundaries('one two three', [
      { index: 0, startMs: 0, endMs: 300 },
      // word 1 missing → interpolated from neighbours
      { index: 2, startMs: 600, endMs: 900 },
    ]);
    expect(a.words[0]!.endMs).toBe(300);
    expect(a.words[1]!.startMs).toBe(300); // continues from word 0
    expect(a.words[2]!.startMs).toBe(600);
    expect(a.totalMs).toBe(900);
  });
});

describe('wordAtTime / timeOfWord', () => {
  it('maps time to word index and back, clamped', () => {
    const a = estimateAlignment('alpha beta gamma', 3000);
    expect(wordAtTime(a, -100)).toBe(0);
    expect(wordAtTime(a, 999999)).toBe(2);
    expect(wordAtTime(a, a.words[1]!.startMs)).toBe(1);
    expect(timeOfWord(a, 1)).toBe(a.words[1]!.startMs);
    expect(timeOfWord(a, 99)).toBe(0);
  });

  it('returns -1 for an empty alignment', () => {
    expect(wordAtTime(estimateAlignment('', 1000), 5)).toBe(-1);
  });
});
