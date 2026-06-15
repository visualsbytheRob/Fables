/**
 * Tests for story-gen.ts (F1731/F1732/F1733).
 */

import { describe, expect, it } from 'vitest';
import { compile } from '@fables/forge-dsl';
import {
  cardRetrievability,
  generateReviewStory,
  masteryGate,
  type ReviewCardInput,
} from './story-gen.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function noErrors(source: string): void {
  const result = compile(source);
  const errorDiags = result.diagnostics.filter((d) => d.severity === 'error');
  expect(result.ok, `compile failed:\n${errorDiags.map((d) => d.message).join('\n')}`).toBe(true);
  expect(errorDiags).toHaveLength(0);
}

const CARD_A: ReviewCardInput = {
  id: 'a1',
  prompt: 'What is the capital of France?',
  answer: 'Paris',
};
const CARD_B: ReviewCardInput = { id: 'b2', prompt: 'What is 2 + 2?', answer: 'Four' };
const CARD_C: ReviewCardInput = { id: 'c3', prompt: 'Who wrote Hamlet?', answer: 'Shakespeare' };

// ---------------------------------------------------------------------------
// generateReviewStory — structural tests
// ---------------------------------------------------------------------------

describe('generateReviewStory', () => {
  it('empty cards: compiles clean and intro goes to review_done', () => {
    const { source, knotToCard } = generateReviewStory([]);
    noErrors(source);
    expect(source).toContain('-> review_done');
    expect(source).toContain('=== review_done ===');
    expect(source).toContain('-> END');
    expect(Object.keys(knotToCard)).toHaveLength(0);
  });

  it('one card: compiles, knotToCard has one entry, source has quiz tag', () => {
    const { source, knotToCard } = generateReviewStory([CARD_A]);
    noErrors(source);
    expect(source).toContain('# quiz');
    expect(source).toContain('-> END');
    expect(source).toContain('=== card_0 ===');
    expect(source).toContain('=== card_0_reveal ===');
    expect(knotToCard['card_0']).toBe('a1');
    expect(Object.keys(knotToCard)).toHaveLength(1);
  });

  it('three cards: compiles, knotToCard maps all cards, chain is correct', () => {
    const { source, knotToCard } = generateReviewStory([CARD_A, CARD_B, CARD_C]);
    noErrors(source);
    expect(knotToCard['card_0']).toBe('a1');
    expect(knotToCard['card_1']).toBe('b2');
    expect(knotToCard['card_2']).toBe('c3');
    expect(Object.keys(knotToCard)).toHaveLength(3);
    // Last reveal should go to review_done
    expect(source).toContain('=== card_2_reveal ===');
    expect(source).toContain('-> review_done');
    expect(source).toContain('-> END');
  });

  it('custom title and intro appear in source', () => {
    const { source } = generateReviewStory([CARD_A], {
      title: 'Memory Palace',
      intro: 'Step inside and remember.',
    });
    noErrors(source);
    expect(source).toContain('Memory Palace');
    expect(source).toContain('Step inside and remember.');
  });

  it('source contains Recall the answer choice text', () => {
    const { source } = generateReviewStory([CARD_A]);
    noErrors(source);
    expect(source).toContain('[Recall the answer]');
  });
});

// ---------------------------------------------------------------------------
// generateReviewStory — sanitization tests (Forge-breaking inputs)
// ---------------------------------------------------------------------------

describe('generateReviewStory sanitization', () => {
  it('prompt with -> END still compiles', () => {
    const card: ReviewCardInput = { id: 'x1', prompt: '-> END the session now', answer: 'done' };
    const { source } = generateReviewStory([card]);
    noErrors(source);
  });

  it('prompt with [brackets] still compiles', () => {
    const card: ReviewCardInput = {
      id: 'x2',
      prompt: 'Choose [option A] or [option B]',
      answer: 'A',
    };
    const { source } = generateReviewStory([card]);
    noErrors(source);
  });

  it('prompt with === fake === knot markers still compiles', () => {
    const card: ReviewCardInput = {
      id: 'x3',
      prompt: '=== fake_knot === text here',
      answer: 'nothing',
    };
    const { source } = generateReviewStory([card]);
    noErrors(source);
  });

  it('prompt with {braces} still compiles', () => {
    const card: ReviewCardInput = { id: 'x4', prompt: 'Use {variable} here', answer: 'no braces' };
    const { source } = generateReviewStory([card]);
    noErrors(source);
  });

  it('prompt with newlines still compiles', () => {
    const card: ReviewCardInput = {
      id: 'x5',
      prompt: 'Line one\nLine two\nLine three',
      answer: 'multi',
    };
    const { source } = generateReviewStory([card]);
    noErrors(source);
  });

  it('all Forge-breakers combined still compiles', () => {
    const card: ReviewCardInput = {
      id: 'x6',
      prompt: '=== knot ===\n-> END [choice] {var} # tag',
      answer: '-> done [A] {B} === end ===',
    };
    const { source } = generateReviewStory([card]);
    noErrors(source);
  });

  it('empty-string prompt falls back to placeholder', () => {
    const card: ReviewCardInput = { id: 'x7', prompt: '', answer: '' };
    const { source } = generateReviewStory([card]);
    noErrors(source);
    expect(source).toContain('(no text)');
  });
});

// ---------------------------------------------------------------------------
// cardRetrievability tests
// ---------------------------------------------------------------------------

describe('cardRetrievability', () => {
  it('new card with no stability returns 0', () => {
    const card: ReviewCardInput = { id: 'n1', prompt: 'q', answer: 'a' };
    expect(cardRetrievability(card)).toBe(0);
  });

  it('card with null stability returns 0', () => {
    const card: ReviewCardInput = { id: 'n2', prompt: 'q', answer: 'a', stability: null };
    expect(cardRetrievability(card)).toBe(0);
  });

  it('card with null lastReview returns 0', () => {
    const card: ReviewCardInput = {
      id: 'n3',
      prompt: 'q',
      answer: 'a',
      stability: 10,
      lastReview: null,
    };
    expect(cardRetrievability(card)).toBe(0);
  });

  it('card reviewed exactly stability days ago has retrievability ~0.9', () => {
    const stability = 10;
    const now = new Date('2025-01-11T12:00:00Z');
    const reviewed = new Date(now.getTime() - stability * 86_400_000).toISOString();
    const card: ReviewCardInput = {
      id: 'r1',
      prompt: 'q',
      answer: 'a',
      stability,
      lastReview: reviewed,
    };
    const r = cardRetrievability(card, now.toISOString());
    expect(r).toBeCloseTo(0.9, 5);
  });

  it('card reviewed very recently has retrievability near 1', () => {
    const now = new Date('2025-01-11T12:00:00Z');
    const reviewed = new Date(now.getTime() - 60_000).toISOString(); // 1 minute ago
    const card: ReviewCardInput = {
      id: 'r2',
      prompt: 'q',
      answer: 'a',
      stability: 10,
      lastReview: reviewed,
    };
    const r = cardRetrievability(card, now.toISOString());
    expect(r).toBeGreaterThan(0.99);
  });
});

// ---------------------------------------------------------------------------
// masteryGate tests
// ---------------------------------------------------------------------------

describe('masteryGate', () => {
  it('empty set returns false', () => {
    expect(masteryGate([], 0.8)).toBe(false);
  });

  it('new card (no stability) is not mastered at any positive threshold', () => {
    const card: ReviewCardInput = { id: 'm1', prompt: 'q', answer: 'a' };
    // retrievability is 0 for a new card, which is < any positive threshold
    expect(masteryGate([card], 0.5)).toBe(false);
    expect(masteryGate([card], 0.1)).toBe(false);
    expect(masteryGate([card], 0.01)).toBe(false);
  });

  it('all cards above threshold: gate is true', () => {
    const now = new Date('2025-06-15T12:00:00Z');
    // Reviewed 1 day ago with stability=10 days -> retrievability well above 0.8
    const reviewed = new Date(now.getTime() - 1 * 86_400_000).toISOString();
    const cards: ReviewCardInput[] = [
      { id: 'm2', prompt: 'q', answer: 'a', stability: 10, lastReview: reviewed },
      { id: 'm3', prompt: 'q2', answer: 'a2', stability: 15, lastReview: reviewed },
    ];
    expect(masteryGate(cards, 0.8, now.toISOString())).toBe(true);
  });

  it('one new card in an otherwise mastered set makes gate false', () => {
    const now = new Date('2025-06-15T12:00:00Z');
    const reviewed = new Date(now.getTime() - 1 * 86_400_000).toISOString();
    const cards: ReviewCardInput[] = [
      { id: 'm4', prompt: 'q', answer: 'a', stability: 10, lastReview: reviewed },
      { id: 'm5', prompt: 'new card', answer: 'a' }, // new, no stability
    ];
    expect(masteryGate(cards, 0.8, now.toISOString())).toBe(false);
  });

  it('card at exactly threshold boundary is treated as mastered', () => {
    const stability = 10;
    const now = new Date('2025-01-11T12:00:00Z');
    // Reviewed exactly stability days ago -> retrievability == 0.9
    const reviewed = new Date(now.getTime() - stability * 86_400_000).toISOString();
    const card: ReviewCardInput = {
      id: 'm6',
      prompt: 'q',
      answer: 'a',
      stability,
      lastReview: reviewed,
    };
    // At threshold 0.9, card retrievability == 0.9 so should pass
    expect(masteryGate([card], 0.9, now.toISOString())).toBe(true);
    // Just above the threshold should fail
    expect(masteryGate([card], 0.91, now.toISOString())).toBe(false);
  });
});
