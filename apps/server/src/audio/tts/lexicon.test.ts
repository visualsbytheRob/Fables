import { describe, expect, it } from 'vitest';
import { applyLexicon, parseLexicon } from './lexicon.js';

// ---------------------------------------------------------------------------
// parseLexicon
// ---------------------------------------------------------------------------

describe('parseLexicon', () => {
  it('parses a simple single-word entry', () => {
    const lex = parseLexicon('Mira: MEE-rah');
    expect(lex.get('mira')).toBe('MEE-rah');
  });

  it('lowercases keys', () => {
    const lex = parseLexicon('MIRA: MEE-rah');
    expect(lex.has('mira')).toBe(true);
    expect(lex.has('MIRA')).toBe(false);
  });

  it('parses multi-word keys', () => {
    const lex = parseLexicon('Mira Vale: MEE-rah Vale');
    expect(lex.get('mira vale')).toBe('MEE-rah Vale');
  });

  it('ignores blank lines', () => {
    const lex = parseLexicon('\nMira: MEE-rah\n\n');
    expect(lex.size).toBe(1);
  });

  it('ignores # comment lines', () => {
    const lex = parseLexicon('# This is a comment\nMira: MEE-rah');
    expect(lex.size).toBe(1);
    expect(lex.get('mira')).toBe('MEE-rah');
  });

  it('ignores lines without a colon', () => {
    const lex = parseLexicon('not a valid line\nMira: MEE-rah');
    expect(lex.size).toBe(1);
  });

  it('parses multiple entries', () => {
    const lex = parseLexicon('Mira: MEE-rah\nVale: VALE');
    expect(lex.size).toBe(2);
    expect(lex.get('vale')).toBe('VALE');
  });

  it('trims whitespace from keys and respellings', () => {
    const lex = parseLexicon('  Mira  :  MEE-rah  ');
    expect(lex.get('mira')).toBe('MEE-rah');
  });

  it('returns an empty map for empty input', () => {
    expect(parseLexicon('').size).toBe(0);
  });

  it('returns an empty map for comment-only input', () => {
    expect(parseLexicon('# just a comment').size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyLexicon
// ---------------------------------------------------------------------------

describe('applyLexicon', () => {
  it('replaces a single word', () => {
    const lex = parseLexicon('Mira: MEE-rah');
    expect(applyLexicon('Mira walked in.', lex)).toBe('MEE-rah walked in.');
  });

  it('is case-insensitive in matching', () => {
    const lex = parseLexicon('mira: MEE-rah');
    expect(applyLexicon('MIRA walked in.', lex)).toBe('MEE-rah walked in.');
    expect(applyLexicon('mira walked in.', lex)).toBe('MEE-rah walked in.');
    expect(applyLexicon('Mira walked in.', lex)).toBe('MEE-rah walked in.');
  });

  it('emits the respelling verbatim (preserves respelling casing)', () => {
    const lex = parseLexicon('mira: MEE-rah');
    expect(applyLexicon('mira', lex)).toBe('MEE-rah');
  });

  it('does NOT replace inside a larger word', () => {
    const lex = parseLexicon('Mira: MEE-rah');
    // "Admiral" contains "mira" — must not be touched
    expect(applyLexicon('Admiral sailed.', lex)).toBe('Admiral sailed.');
  });

  it('does not replace a substring that is not a whole word', () => {
    const lex = parseLexicon('rat: RAT');
    expect(applyLexicon('grateful', lex)).toBe('grateful');
    expect(applyLexicon('rat', lex)).toBe('RAT');
  });

  it('replaces a multi-word key', () => {
    const lex = parseLexicon('Mira Vale: MEE-rah Vale');
    expect(applyLexicon('She met Mira Vale there.', lex)).toBe('She met MEE-rah Vale there.');
  });

  it('longer key wins over shorter key (longest-match precedence)', () => {
    const lex = parseLexicon('Mira: MEE-rah\nMira Vale: MEE-rah VAYL');
    // "Mira Vale" should match, not just "Mira"
    expect(applyLexicon('Mira Vale spoke.', lex)).toBe('MEE-rah VAYL spoke.');
  });

  it('shorter key still applies where the longer key does not match', () => {
    const lex = parseLexicon('Mira: MEE-rah\nMira Vale: MEE-rah VAYL');
    expect(applyLexicon('Mira smiled.', lex)).toBe('MEE-rah smiled.');
  });

  it('replaces multiple occurrences', () => {
    const lex = parseLexicon('Mira: MEE-rah');
    expect(applyLexicon('Mira and Mira', lex)).toBe('MEE-rah and MEE-rah');
  });

  it('preserves surrounding punctuation', () => {
    const lex = parseLexicon('Mira: MEE-rah');
    expect(applyLexicon('"Mira!"', lex)).toBe('"MEE-rah!"');
  });

  it('returns the input unchanged when lexicon is empty', () => {
    const lex = parseLexicon('');
    expect(applyLexicon('Hello world', lex)).toBe('Hello world');
  });

  it('handles a key that appears at the very start and end of text', () => {
    const lex = parseLexicon('go: GO');
    expect(applyLexicon('go now go', lex)).toBe('GO now GO');
  });
});
