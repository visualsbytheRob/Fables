import { describe, expect, it } from 'vitest';
import { filterCodex } from './Codex.js';
import { formatRevealed } from './EntityCard.js';
import { MAX_LORE_DEPTH, resolveLoreTitle } from './LorePopover.js';
import type { CodexEntry } from '../api/client.js';

const entry = (over: Partial<CodexEntry>): CodexEntry => ({
  entryId: 'e1',
  entityId: 'ent1',
  type: 'character',
  name: 'Fox',
  noteId: null,
  metAt: '',
  encounters: 1,
  revealedFields: {},
  ...over,
});

describe('filterCodex', () => {
  const entries: CodexEntry[] = [
    entry({ entryId: 'a', name: 'Fox', type: 'character', revealedFields: { trait: 'cunning' } }),
    entry({ entryId: 'b', name: 'Crow', type: 'character', revealedFields: { holds: 'cheese' } }),
    entry({ entryId: 'c', name: 'Forest', type: 'place', revealedFields: {} }),
  ];

  it('returns everything with no query and the "all" filter', () => {
    expect(filterCodex(entries, '', 'all')).toHaveLength(3);
  });

  it('filters by type', () => {
    expect(filterCodex(entries, '', 'place').map((e) => e.name)).toEqual(['Forest']);
    expect(filterCodex(entries, '', 'character')).toHaveLength(2);
  });

  it('matches on name case-insensitively', () => {
    expect(filterCodex(entries, 'cr', 'all').map((e) => e.name)).toEqual(['Crow']);
  });

  it('matches on revealed field values', () => {
    expect(filterCodex(entries, 'cheese', 'all').map((e) => e.name)).toEqual(['Crow']);
    expect(filterCodex(entries, 'cunning', 'all').map((e) => e.name)).toEqual(['Fox']);
  });

  it('combines type filter and query', () => {
    expect(filterCodex(entries, 'fo', 'place').map((e) => e.name)).toEqual(['Forest']);
  });
});

describe('formatRevealed', () => {
  it('joins lists', () => {
    expect(formatRevealed(['a', 'b', 'c'])).toBe('a, b, c');
  });
  it('renders booleans as yes/no', () => {
    expect(formatRevealed(true)).toBe('yes');
    expect(formatRevealed(false)).toBe('no');
  });
  it('stringifies scalars and dashes null', () => {
    expect(formatRevealed(42)).toBe('42');
    expect(formatRevealed('hi')).toBe('hi');
    expect(formatRevealed(null)).toBe('—');
    expect(formatRevealed(undefined)).toBe('—');
  });
});

describe('resolveLoreTitle', () => {
  const index = new Map([
    ['the crow', 'note-crow'],
    ['the cheese', 'note-cheese'],
  ]);
  it('resolves case-insensitively with trimming', () => {
    expect(resolveLoreTitle('  The Crow ', index)).toBe('note-crow');
  });
  it('returns null for a missing (e.g. deleted) note', () => {
    expect(resolveLoreTitle('The Lion', index)).toBeNull();
  });
  it('caps lore depth at a small, finite value', () => {
    expect(MAX_LORE_DEPTH).toBeGreaterThanOrEqual(1);
    expect(MAX_LORE_DEPTH).toBeLessThanOrEqual(4);
  });
});
