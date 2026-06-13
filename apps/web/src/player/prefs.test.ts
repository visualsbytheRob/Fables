// @vitest-environment jsdom
/** localStorage persistence tests (F549/F553/F563/F568/F575/F577/F578). */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  addBookmark,
  bumpStats,
  clearRecent,
  formatDuration,
  loadBookmarks,
  loadEndings,
  loadLibraryMeta,
  loadPlaythroughs,
  loadPrefs,
  loadRecents,
  loadStats,
  recordEnding,
  recordPlaythrough,
  recordRecent,
  removeBookmark,
  saveLibraryMeta,
  savePrefs,
} from './prefs.js';

afterEach(() => localStorage.clear());

describe('reader prefs (F553)', () => {
  it('round-trips and falls back to defaults on junk', () => {
    savePrefs({ ...DEFAULT_PREFS, textSize: 22, theme: 'terminal' });
    expect(loadPrefs().textSize).toBe(22);
    expect(loadPrefs().theme).toBe('terminal');

    localStorage.setItem('fables.player.prefs', '{"theme":"comic-sans"}');
    expect(loadPrefs().theme).toBe('serif');

    localStorage.setItem('fables.player.prefs', 'not json');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});

describe('endings collection (F568)', () => {
  it('records first discovery and counts repeats', () => {
    recordEnding('s1', 'good', 'The Good End');
    const after = recordEnding('s1', 'good', 'The Good End');
    expect(after).toHaveLength(1);
    expect(after[0]?.timesReached).toBe(2);
    recordEnding('s1', 'bad', 'The Bad End');
    expect(loadEndings('s1')).toHaveLength(2);
    expect(loadEndings('other')).toHaveLength(0);
  });
});

describe('bookmarks (F563/F564)', () => {
  it('adds, lists and removes per story', () => {
    const bookmark = {
      id: 'bm1',
      saveId: 'sv1',
      note: 'before the duel',
      turn: 3,
      scene: 'court',
      createdAt: new Date().toISOString(),
    };
    addBookmark('s1', bookmark);
    expect(loadBookmarks('s1')[0]?.note).toBe('before the duel');
    removeBookmark('s1', 'bm1');
    expect(loadBookmarks('s1')).toHaveLength(0);
  });
});

describe('reading stats (F577)', () => {
  it('accumulates deltas', () => {
    bumpStats('s1', { secondsRead: 10, choicesMade: 1 });
    bumpStats('s1', { secondsRead: 10, runsFinished: 1 });
    const stats = loadStats('s1');
    expect(stats.secondsRead).toBe(20);
    expect(stats.choicesMade).toBe(1);
    expect(stats.runsFinished).toBe(1);
    expect(stats.lastPlayedAt).not.toBeNull();
  });

  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(620)).toBe('10m');
    expect(formatDuration(3900)).toBe('1h 5m');
  });
});

describe('continue-reading rail (F575)', () => {
  it('keeps the latest entry per story, newest first', () => {
    recordRecent({ storyId: 'a', title: 'A', scene: '', turn: 1, at: '2026-01-01' });
    recordRecent({ storyId: 'b', title: 'B', scene: '', turn: 1, at: '2026-01-02' });
    recordRecent({ storyId: 'a', title: 'A', scene: 'gate', turn: 4, at: '2026-01-03' });
    const recents = loadRecents();
    expect(recents.map((r) => r.storyId)).toEqual(['a', 'b']);
    expect(recents[0]?.turn).toBe(4);
    clearRecent('a');
    expect(loadRecents().map((r) => r.storyId)).toEqual(['b']);
  });
});

describe('playthrough log (F569)', () => {
  it('caps stored playthroughs', () => {
    for (let i = 0; i < 8; i++) {
      recordPlaythrough('s1', { endedAt: `2026-01-0${i + 1}`, ending: `e${i}`, transcript: 't' });
    }
    expect(loadPlaythroughs('s1')).toHaveLength(6);
    expect(loadPlaythroughs('s1')[0]?.ending).toBe('e7');
  });
});

describe('library metadata (F573/F578)', () => {
  it('persists author/tags/archived locally', () => {
    saveLibraryMeta('s1', { author: 'Aesop', tags: ['fable'], contentNotes: '', archived: true });
    const meta = loadLibraryMeta('s1');
    expect(meta.author).toBe('Aesop');
    expect(meta.archived).toBe(true);
    expect(loadLibraryMeta('s2').archived).toBe(false);
  });
});
