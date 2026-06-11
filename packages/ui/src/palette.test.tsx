// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { filterCommands, fuzzyMatch, type PaletteCommand } from './palette.js';

const commands: PaletteCommand[] = [
  { id: 'new-note', label: 'New note', run: () => {} },
  { id: 'today', label: 'Open today', keywords: 'daily journal', run: () => {} },
  { id: 'graph', label: 'Show graph', run: () => {} },
];

describe('fuzzy matching', () => {
  it('matches subsequences case-insensitively', () => {
    expect(fuzzyMatch('nwnt', 'New note')).toBe(true);
    expect(fuzzyMatch('NEW', 'new note')).toBe(true);
    expect(fuzzyMatch('xyz', 'New note')).toBe(false);
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });

  it('filters by label and keywords, empty query returns all', () => {
    expect(filterCommands(commands, '')).toHaveLength(3);
    expect(filterCommands(commands, 'journal').map((c) => c.id)).toEqual(['today']);
    expect(filterCommands(commands, 'gr').map((c) => c.id)).toEqual(['graph']);
  });
});
