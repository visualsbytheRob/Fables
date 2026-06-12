import { describe, expect, it } from 'vitest';
import { detectMentions, type MentionCandidate } from './mentions.js';
import { contextSnippet } from './snippets.js';

const kira: MentionCandidate = { id: 'note_kira', names: ['Kira Vane'] };

describe('detectMentions (F221, F230)', () => {
  it('finds case-insensitive, word-bounded title hits', () => {
    const hits = detectMentions('Met kira vane at the dock. KIRA VANE waved.', [kira]);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ id: 'note_kira', text: 'kira vane', position: 4 });
    expect(hits[1]!.text).toBe('KIRA VANE');
  });

  it('enforces word boundaries (F227)', () => {
    expect(detectMentions('Akira Vane is not her; kira vanes neither', [kira])).toEqual([]);
    expect(detectMentions('punctuation: (Kira Vane), works', [kira])).toHaveLength(1);
  });

  it('is unicode-aware at boundaries', () => {
    const cafe: MentionCandidate = { id: 'n1', names: ['Café'] };
    expect(detectMentions('at the Café!', [cafe])).toHaveLength(1);
    expect(detectMentions('decaféinated', [cafe])).toEqual([]);
  });

  it('excludes code blocks, inline code, URLs, and existing wikilinks (F229)', () => {
    const body = [
      '[[Kira Vane]] linked already',
      '`Kira Vane` inline code',
      '```',
      'Kira Vane fenced',
      '```',
      'https://example.com/Kira%20Vane?q=Kira+Vane',
      'but Kira Vane in prose counts',
    ].join('\n');
    const hits = detectMentions(body, [kira]);
    expect(hits).toHaveLength(1);
    expect(body.slice(hits[0]!.position, hits[0]!.position + hits[0]!.length)).toBe('Kira Vane');
  });

  it('does not match the title inside a wikilink alias', () => {
    expect(detectMentions('[[Someone Else|Kira Vane]]', [kira])).toEqual([]);
  });

  it('skips single-character names', () => {
    expect(detectMentions('A note about A', [{ id: 'n', names: ['A'] }])).toEqual([]);
  });

  it('supports aliases per candidate (F226-ready) and longest-match de-overlap', () => {
    const candidates: MentionCandidate[] = [
      { id: 'ent_kira', names: ['Kira Vane', 'the Captain'] },
      { id: 'note_vane', names: ['Vane'] },
    ];
    const hits = detectMentions('Kira Vane, the Captain, then Vane alone', candidates);
    expect(hits.map((h) => [h.id, h.text])).toEqual([
      ['ent_kira', 'Kira Vane'],
      ['ent_kira', 'the Captain'],
      ['note_vane', 'Vane'],
    ]);
  });

  it('is deterministic for ties', () => {
    const candidates: MentionCandidate[] = [
      { id: 'b', names: ['same title'] },
      { id: 'a', names: ['same title'] },
    ];
    expect(detectMentions('same title', candidates)[0]!.id).toBe('a');
  });
});

describe('contextSnippet (F213, F220)', () => {
  it('returns the whole body when it fits the radius', () => {
    const snippet = contextSnippet('short body with hit inside', 16, 3);
    expect(snippet.text).toBe('short body with hit inside');
    expect(snippet.text.slice(snippet.highlightStart, snippet.highlightEnd)).toBe('hit');
    expect(snippet.truncatedStart).toBe(false);
    expect(snippet.truncatedEnd).toBe(false);
  });

  it('trims to word boundaries on both sides', () => {
    const before = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima ';
    const after = ' november oscar papa quebec romeo sierra tango uniform victor whiskey xray';
    const body = `${before}MATCH${after}`;
    const snippet = contextSnippet(body, before.length, 5, 40);
    expect(snippet.text.slice(snippet.highlightStart, snippet.highlightEnd)).toBe('MATCH');
    expect(snippet.truncatedStart).toBe(true);
    expect(snippet.truncatedEnd).toBe(true);
    // No partial words at the edges.
    expect(before).toContain(`${snippet.text.split(' ')[0]!} `);
    expect(snippet.text.startsWith(' ')).toBe(false);
    expect(snippet.text.endsWith(' ')).toBe(false);
  });

  it('never trims into the match itself, even with no whitespace around', () => {
    const body = `${'a'.repeat(200)}MATCH${'b'.repeat(200)}`;
    const snippet = contextSnippet(body, 200, 5, 40);
    expect(snippet.text).toBe('MATCH');
    expect(snippet.highlightStart).toBe(0);
    expect(snippet.highlightEnd).toBe(5);
  });

  it('handles matches at the very start and end of the body', () => {
    const head = contextSnippet('hit at the start of things', 0, 3, 10);
    expect(head.text.slice(head.highlightStart, head.highlightEnd)).toBe('hit');
    expect(head.truncatedStart).toBe(false);

    const body = `${'word '.repeat(20)}end`;
    const tail = contextSnippet(body, body.length - 3, 3, 10);
    expect(tail.text.slice(tail.highlightStart, tail.highlightEnd)).toBe('end');
    expect(tail.truncatedEnd).toBe(false);
  });

  it('flattens newlines without shifting highlight offsets', () => {
    const body = 'line one\nline two has the hit word\nline three';
    const at = body.indexOf('hit');
    const snippet = contextSnippet(body, at, 3, 20);
    expect(snippet.text).not.toContain('\n');
    expect(snippet.text.slice(snippet.highlightStart, snippet.highlightEnd)).toBe('hit');
  });

  it('clamps out-of-range positions defensively', () => {
    const snippet = contextSnippet('tiny', 99, 5, 10);
    expect(snippet.text).toBe('tiny');
    expect(snippet.highlightStart).toBe(snippet.highlightEnd);
  });
});
