/**
 * Tests for flashcard extraction (F1711–F1715).
 */

import { describe, expect, it } from 'vitest';
import { extractCards, extractCloze, extractQA, suggestCards } from './extract.js';

// ---------------------------------------------------------------------------
// extractCloze
// ---------------------------------------------------------------------------

describe('extractCloze', () => {
  it('returns [] for text with no cloze markup', () => {
    expect(extractCloze('The quick brown fox.')).toEqual([]);
    expect(extractCloze('')).toEqual([]);
  });

  it('extracts a single c1 cloze card', () => {
    const cards = extractCloze('The capital of France is {{c1::Paris}}.');
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.kind).toBe('cloze');
    expect(card.blockRef).toBe('cloze:c1');
    expect(card.prompt).toBe('The capital of France is [...].');
    expect(card.answer).toBe('The capital of France is Paris.');
  });

  it('extracts a cloze card with a hint', () => {
    const cards = extractCloze('The speed of light is {{c1::299792458::speed}} m/s.');
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.prompt).toBe('The speed of light is [speed] m/s.');
    expect(card.answer).toBe('The speed of light is 299792458 m/s.');
    expect(card.blockRef).toBe('cloze:c1');
  });

  it('multi-cloze: c1 and c2 yield two cards in ascending index order', () => {
    const text = '{{c1::Alpha}} and {{c2::Beta}} are Greek letters.';
    const cards = extractCloze(text);
    expect(cards).toHaveLength(2);

    const c1 = cards[0]!;
    expect(c1.blockRef).toBe('cloze:c1');
    // c1 is hidden, c2 is revealed
    expect(c1.prompt).toBe('[...] and Beta are Greek letters.');
    expect(c1.answer).toBe('Alpha and Beta are Greek letters.');

    const c2 = cards[1]!;
    expect(c2.blockRef).toBe('cloze:c2');
    // c1 is revealed, c2 is hidden
    expect(c2.prompt).toBe('Alpha and [...] are Greek letters.');
    expect(c2.answer).toBe('Alpha and Beta are Greek letters.');
  });

  it('multi-cloze with hints: correct deletion and reveal per card', () => {
    const text = '{{c1::Mitosis::cell division}} produces {{c2::two::number}} cells.';
    const cards = extractCloze(text);
    expect(cards).toHaveLength(2);

    expect(cards[0]!.prompt).toBe('[cell division] produces two cells.');
    expect(cards[1]!.prompt).toBe('Mitosis produces [number] cells.');
    expect(cards[0]!.answer).toBe('Mitosis produces two cells.');
    expect(cards[1]!.answer).toBe('Mitosis produces two cells.');
  });

  it('same index appearing twice only produces one card (blockRef unique)', () => {
    const text = '{{c1::A}} and {{c1::B}}.';
    const cards = extractCloze(text);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.blockRef).toBe('cloze:c1');
  });

  it('indices are sorted ascending (c3 before c10 with numeric sort)', () => {
    const text = '{{c10::ten}} and {{c3::three}}.';
    const cards = extractCloze(text);
    expect(cards[0]!.blockRef).toBe('cloze:c3');
    expect(cards[1]!.blockRef).toBe('cloze:c10');
  });
});

// ---------------------------------------------------------------------------
// extractQA
// ---------------------------------------------------------------------------

describe('extractQA', () => {
  it('returns [] for text with no Q:/A: pairs', () => {
    expect(extractQA('Just some prose.')).toEqual([]);
    expect(extractQA('')).toEqual([]);
  });

  it('extracts a single Q&A pair', () => {
    const text = 'Q: What is the capital of France?\nA: Paris';
    const cards = extractQA(text);
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.kind).toBe('qa');
    expect(card.prompt).toBe('What is the capital of France?');
    expect(card.answer).toBe('Paris');
    expect(card.blockRef).toBe('qa:0');
  });

  it('extracts multiple Q&A pairs with correct blockRefs', () => {
    const text = [
      'Q: First question?',
      'A: First answer.',
      'Q: Second question?',
      'A: Second answer.',
    ].join('\n');
    const cards = extractQA(text);
    expect(cards).toHaveLength(2);
    expect(cards[0]!.blockRef).toBe('qa:0');
    expect(cards[0]!.prompt).toBe('First question?');
    expect(cards[1]!.blockRef).toBe('qa:1');
    expect(cards[1]!.prompt).toBe('Second question?');
  });

  it('case-insensitive Q: and A: prefixes', () => {
    const text = 'q: What year?\na: 2024';
    const cards = extractQA(text);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.answer).toBe('2024');
  });

  it('multiline answer — continues until blank line', () => {
    const text =
      'Q: Describe photosynthesis.\nA: Plants absorb sunlight\nand convert CO2 to glucose.\n\nOther text.';
    const cards = extractQA(text);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.answer).toBe('Plants absorb sunlight and convert CO2 to glucose.');
  });

  it('multiline answer — stops at next Q:', () => {
    const text = 'Q: First?\nA: Line one\nLine two\nQ: Second?\nA: Answer two';
    const cards = extractQA(text);
    expect(cards).toHaveLength(2);
    expect(cards[0]!.answer).toBe('Line one Line two');
    expect(cards[1]!.answer).toBe('Answer two');
  });
});

// ---------------------------------------------------------------------------
// suggestCards
// ---------------------------------------------------------------------------

describe('suggestCards — definitions', () => {
  it('returns [] for plain prose', () => {
    expect(suggestCards('The quick brown fox jumps over the lazy dog.')).toEqual([]);
    expect(suggestCards('')).toEqual([]);
  });

  it('extracts a colon-separated definition', () => {
    const cards = suggestCards('Photosynthesis: the process by which plants make food');
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.kind).toBe('definition');
    expect(card.prompt).toBe('Photosynthesis');
    expect(card.answer).toBe('the process by which plants make food');
    expect(card.blockRef).toBe('def:1');
  });

  it('extracts an em-dash separated definition', () => {
    const cards = suggestCards('Entropy — a measure of disorder in a system');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.kind).toBe('definition');
    expect(cards[0]!.prompt).toBe('Entropy');
    expect(cards[0]!.answer).toBe('a measure of disorder in a system');
  });

  it('extracts a hyphen-with-spaces separated definition', () => {
    const cards = suggestCards('RNA - a single-stranded nucleic acid');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.kind).toBe('definition');
    expect(cards[0]!.prompt).toBe('RNA');
    expect(cards[0]!.answer).toBe('a single-stranded nucleic acid');
  });

  it('skips a Q: line that looks like a definition', () => {
    const cards = suggestCards('Q: What is gravity?');
    const defCards = cards.filter((c) => c.kind === 'definition');
    expect(defCards).toHaveLength(0);
  });

  it('skips definitions with empty right-hand side', () => {
    const cards = suggestCards('Term:');
    expect(cards).toHaveLength(0);
  });

  it('skips definition when term exceeds 6 words', () => {
    const cards = suggestCards('One two three four five six seven: definition here');
    expect(cards).toHaveLength(0);
  });

  it('blockRef reflects the 1-based line number', () => {
    const text = 'Prose line here.\nGravity: attractive force between masses';
    const cards = suggestCards(text);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.blockRef).toBe('def:2');
  });
});

describe('suggestCards — list under heading', () => {
  it('produces a list card for a heading with 2+ bullets', () => {
    const text = '## Primary colours\n- Red\n- Blue\n- Yellow';
    const cards = suggestCards(text);
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.kind).toBe('list');
    expect(card.prompt).toBe('List the items under "Primary colours"');
    expect(card.answer).toBe('Red, Blue, Yellow');
    expect(card.blockRef).toBe('list:1');
  });

  it('does NOT produce a list card for a heading with only 1 bullet', () => {
    const text = '## Solo\n- Only item';
    const cards = suggestCards(text);
    expect(cards.filter((c) => c.kind === 'list')).toHaveLength(0);
  });

  it('accepts * bullets as well as - bullets', () => {
    const text = '# Fruits\n* Apple\n* Banana';
    const cards = suggestCards(text);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.kind).toBe('list');
    expect(cards[0]!.answer).toBe('Apple, Banana');
  });

  it('uses the heading line number in blockRef', () => {
    const text = 'Some text.\n## My List\n- A\n- B';
    const cards = suggestCards(text);
    const listCard = cards.find((c) => c.kind === 'list');
    expect(listCard).toBeDefined();
    expect(listCard!.blockRef).toBe('list:2');
  });
});

// ---------------------------------------------------------------------------
// extractCards — combine + dedup + ordering
// ---------------------------------------------------------------------------

describe('extractCards', () => {
  it('returns [] for empty text', () => {
    expect(extractCards('')).toEqual([]);
  });

  it('combines cloze then qa then suggestions in that order', () => {
    const text = [
      '{{c1::Paris}} is the capital.',
      'Q: What colour is the sky?',
      'A: Blue',
      'Gravity: attraction between masses',
    ].join('\n');
    const cards = extractCards(text);
    const kinds = cards.map((c) => c.kind);
    // cloze first, then qa, then definition
    expect(kinds[0]).toBe('cloze');
    expect(kinds[1]).toBe('qa');
    expect(kinds[2]).toBe('definition');
  });

  it('deduplicates by blockRef (first wins)', () => {
    // Craft a scenario where blockRefs would collide (shouldn't happen in
    // practice, but the dedup logic must hold).
    const text = '{{c1::Alpha}}.\nQ: question?\nA: answer';
    const cards = extractCards(text);
    const refs = cards.map((c) => c.blockRef);
    const unique = new Set(refs);
    expect(refs.length).toBe(unique.size);
  });

  it('handles a rich note with all card types', () => {
    const text = [
      '# Note title',
      '',
      '{{c1::Osmosis}} is the movement of water.',
      '',
      'Q: Define diffusion.',
      'A: Movement of particles from high to low concentration.',
      '',
      'Mitosis: cell division producing two identical daughter cells',
      '',
      '## Organelles',
      '- Nucleus',
      '- Mitochondria',
      '- Ribosome',
    ].join('\n');
    const cards = extractCards(text);
    const kinds = cards.map((c) => c.kind);
    expect(kinds).toContain('cloze');
    expect(kinds).toContain('qa');
    expect(kinds).toContain('definition');
    expect(kinds).toContain('list');
    // All blockRefs unique
    const refs = cards.map((c) => c.blockRef);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('cloze appears before qa before definition in output', (): void => {
    const text = 'Def: value\nQ: Q?\nA: A\n{{c1::X}}';
    const cards = extractCards(text);
    const clozeIdx = cards.findIndex((c) => c.kind === 'cloze');
    const qaIdx = cards.findIndex((c) => c.kind === 'qa');
    const defIdx = cards.findIndex((c) => c.kind === 'definition');
    expect(clozeIdx).toBeLessThan(qaIdx);
    expect(qaIdx).toBeLessThan(defIdx);
  });
});
