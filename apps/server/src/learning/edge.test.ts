/**
 * Scheduler edge helpers tests (F1761/F1762/F1765).
 */

import { describe, expect, it } from 'vitest';
import { spaceSiblings, findDuplicates, applyCatchUp, normalizePrompt } from './edge.js';

const card = (id: string, noteId: string | null, prompt: string, state = 'review') => ({
  id,
  noteId,
  prompt,
  state,
});

describe('spaceSiblings (F1761)', () => {
  it('separates cards from the same note when spacing is achievable', () => {
    const cards = [
      card('a1', 'noteA', 'a1'),
      card('a2', 'noteA', 'a2'),
      card('b1', 'noteB', 'b1'),
      card('b2', 'noteB', 'b2'),
    ];
    const spaced = spaceSiblings(cards);
    // A balanced 2+2 set can be fully spaced: no adjacent same-note pair.
    for (let i = 1; i < spaced.length; i++) {
      expect(spaced[i]!.noteId).not.toBe(spaced[i - 1]!.noteId);
    }
    expect(spaced).toHaveLength(4);
  });

  it('minimises adjacency when full spacing is impossible', () => {
    const cards = [
      card('a1', 'noteA', 'a1'),
      card('a2', 'noteA', 'a2'),
      card('a3', 'noteA', 'a3'),
      card('b1', 'noteB', 'b1'),
    ];
    const spaced = spaceSiblings(cards);
    let adjacent = 0;
    for (let i = 1; i < spaced.length; i++) {
      if (spaced[i]!.noteId === spaced[i - 1]!.noteId) adjacent++;
    }
    // 3 A's + 1 B: at most one unavoidable A–A adjacency.
    expect(adjacent).toBeLessThanOrEqual(1);
    expect(spaced).toHaveLength(4);
  });

  it('keeps all cards and treats null noteIds as non-siblings', () => {
    const cards = [card('x', null, 'x'), card('y', null, 'y')];
    expect(spaceSiblings(cards)).toHaveLength(2);
  });
});

describe('findDuplicates (F1762)', () => {
  it('groups cards with the same normalised prompt', () => {
    const cards = [
      card('1', 'n', 'Capital of France?'),
      card('2', 'n', 'capital of  france?'),
      card('3', 'n', 'unique'),
    ];
    const dups = findDuplicates(cards);
    expect(dups).toHaveLength(1);
    expect(dups[0]!.cardIds.sort()).toEqual(['1', '2']);
  });

  it('normalizePrompt collapses case + whitespace', () => {
    expect(normalizePrompt('  Hello   World ')).toBe('hello world');
  });
});

describe('applyCatchUp (F1765)', () => {
  it('caps the session and defers the rest', () => {
    const cards = [
      card('r1', 'n', 'r1', 'review'),
      card('r2', 'n', 'r2', 'review'),
      card('r3', 'n', 'r3', 'review'),
      card('n1', 'n', 'n1', 'new'),
      card('n2', 'n', 'n2', 'new'),
    ];
    const { session, deferred } = applyCatchUp(cards, { dueCap: 2, newCap: 1 });
    expect(session.filter((c) => c.state === 'review')).toHaveLength(2);
    expect(session.filter((c) => c.state === 'new')).toHaveLength(1);
    expect(deferred).toHaveLength(2);
  });
});
