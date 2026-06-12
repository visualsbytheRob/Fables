// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadDefaultNotebook,
  loadExpanded,
  loadRecents,
  loadSort,
  pushRecent,
  removeRecent,
  saveDefaultNotebook,
  saveExpanded,
  saveSort,
} from './prefs.js';

beforeEach(() => localStorage.clear());

describe('notes prefs (F142/F145/F173/F177)', () => {
  it('persists expanded notebook ids', () => {
    expect(loadExpanded().size).toBe(0);
    saveExpanded(new Set(['a', 'b']));
    expect([...loadExpanded()].sort()).toEqual(['a', 'b']);
  });

  it('persists the default capture notebook', () => {
    expect(loadDefaultNotebook()).toBeNull();
    saveDefaultNotebook('nb1');
    expect(loadDefaultNotebook()).toBe('nb1');
  });

  it('validates the stored sort', () => {
    expect(loadSort()).toBe('updated');
    saveSort('title');
    expect(loadSort()).toBe('title');
    localStorage.setItem('fables.notes.sort', JSON.stringify('bogus'));
    expect(loadSort()).toBe('updated');
  });

  it('keeps a deduplicated, capped MRU of recents', () => {
    for (let i = 0; i < 10; i += 1) pushRecent(`n${i}`);
    pushRecent('n3');
    const recents = loadRecents();
    expect(recents[0]).toBe('n3');
    expect(recents).toHaveLength(8);
    expect(new Set(recents).size).toBe(recents.length);
    removeRecent('n3');
    expect(loadRecents()).not.toContain('n3');
  });
});
