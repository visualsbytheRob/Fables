import { describe, it, expect } from 'vitest';
import { attributeDialogue } from './attribution.js';

describe('attributeDialogue', () => {
  // -------------------------------------------------------------------------
  // Basic said-after patterns
  // -------------------------------------------------------------------------

  it('detects a straight-quoted span with verb+speaker after', () => {
    const result = attributeDialogue('"Hello," said Alice.');
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]!.text).toBe('Hello,');
    expect(result.spans[0]!.speaker).toBe('Alice');
  });

  it('detects speaker-then-verb after the quote', () => {
    const result = attributeDialogue('"Come here!" Alice said.');
    expect(result.spans[0]!.speaker).toBe('Alice');
  });

  it('handles multiple attribution verbs', () => {
    const verbs = ['asked', 'replied', 'whispered', 'shouted', 'murmured', 'cried'];
    for (const verb of verbs) {
      const result = attributeDialogue(`"Text." ${verb} Bob.`);
      expect(result.spans[0]!.speaker).toBe('Bob');
    }
  });

  // -------------------------------------------------------------------------
  // Said-before patterns
  // -------------------------------------------------------------------------

  it('detects speaker+verb before the open-quote', () => {
    const result = attributeDialogue('Alice said, "Hello there."');
    expect(result.spans[0]!.speaker).toBe('Alice');
    expect(result.spans[0]!.text).toBe('Hello there.');
  });

  it('detects speaker+verb with colon before the quote', () => {
    const result = attributeDialogue('Then Alice asked: "Are you ready?"');
    expect(result.spans[0]!.speaker).toBe('Alice');
  });

  // -------------------------------------------------------------------------
  // Curly quotes
  // -------------------------------------------------------------------------

  it('handles left/right curly double quotes', () => {
    const result = attributeDialogue('“Good morning,” said Mira.');
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]!.text).toBe('Good morning,');
    expect(result.spans[0]!.speaker).toBe('Mira');
  });

  it('handles curly quotes with before-quote attribution', () => {
    const result = attributeDialogue('Mira said, “Good morning.”');
    expect(result.spans[0]!.speaker).toBe('Mira');
  });

  // -------------------------------------------------------------------------
  // Multiple quotes
  // -------------------------------------------------------------------------

  it('finds multiple quoted spans in order', () => {
    const text = '"First," said Alice. "Second," said Bob.';
    const result = attributeDialogue(text);
    expect(result.spans).toHaveLength(2);
    expect(result.spans[0]!.speaker).toBe('Alice');
    expect(result.spans[1]!.speaker).toBe('Bob');
  });

  it('preserves source order for mixed before/after attribution', () => {
    const text = 'Alice said, "Hello." "Goodbye," Bob replied.';
    const result = attributeDialogue(text);
    expect(result.spans).toHaveLength(2);
    expect(result.spans[0]!.speaker).toBe('Alice');
    expect(result.spans[1]!.speaker).toBe('Bob');
  });

  // -------------------------------------------------------------------------
  // Unknown speaker → null
  // -------------------------------------------------------------------------

  it('returns speaker:null when no attribution pattern is found', () => {
    const result = attributeDialogue('"Hello world."');
    expect(result.spans[0]!.speaker).toBeNull();
  });

  it('returns speaker:null for a bare quote with no surrounding text', () => {
    const result = attributeDialogue('"Just a quote."');
    expect(result.spans[0]!.speaker).toBeNull();
  });

  // -------------------------------------------------------------------------
  // "the <word>" speaker pattern
  // -------------------------------------------------------------------------

  it('attributes "the goblin" as speaker', () => {
    const result = attributeDialogue('"Boo!" cried the goblin.');
    expect(result.spans[0]!.speaker).toBe('the goblin');
  });

  it('attributes "the old wizard" as multi-word the-phrase', () => {
    const result = attributeDialogue('"Beware!" said the old wizard.');
    expect(result.spans[0]!.speaker).toBe('the old wizard');
  });

  // -------------------------------------------------------------------------
  // knownSpeakers disambiguation
  // -------------------------------------------------------------------------

  it('prefers a knownSpeaker name when it appears in context', () => {
    const text = '"I will go," said Mira Vale, stepping forward.';
    const result = attributeDialogue(text, ['Mira Vale']);
    expect(result.spans[0]!.speaker).toBe('Mira Vale');
  });

  it('falls back to heuristic when knownSpeakers do not match', () => {
    const text = '"Over here," called Tom.';
    const result = attributeDialogue(text, ['Alice', 'Bob']);
    expect(result.spans[0]!.speaker).toBe('Tom');
  });

  // -------------------------------------------------------------------------
  // Offset correctness
  // -------------------------------------------------------------------------

  it('reports correct start/end offsets for the quoted span', () => {
    const text = 'She said, "Hello."';
    const result = attributeDialogue(text);
    const span = result.spans[0]!;
    expect(span.start).toBe(10);
    expect(span.end).toBe(18); // index just past the closing quote
    expect(text.slice(span.start, span.end)).toBe('"Hello."');
  });

  it('reports correct offsets for curly-quoted span', () => {
    const text = '“Hi there.” said Eve.';
    const result = attributeDialogue(text);
    const span = result.spans[0]!;
    expect(span.start).toBe(0);
    expect(span.end).toBe(11); // U+201C + "Hi there." + U+201D = 11 chars
    expect(text.slice(span.start, span.end)).toBe('“Hi there.”');
  });

  it('collapses whitespace inside quotes', () => {
    const result = attributeDialogue('"  spaces   everywhere  " said Carl.');
    expect(result.spans[0]!.text).toBe('spaces everywhere');
  });

  // -------------------------------------------------------------------------
  // Multi-word Capitalised speaker name
  // -------------------------------------------------------------------------

  it('captures multi-word capitalised speaker name', () => {
    const result = attributeDialogue('"Ready," said Mira Vale.');
    expect(result.spans[0]!.speaker).toBe('Mira Vale');
  });
});
