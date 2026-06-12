import { describe, expect, it } from 'vitest';
import {
  exportFilename,
  extractHashtags,
  formatBytes,
  readingTimeMinutes,
  relativeTime,
  snippet,
  wordCount,
} from './text.js';

describe('extractHashtags (F152 client mirror)', () => {
  it('finds tags, lowercased and deduplicated', () => {
    expect(extractHashtags('Plot #World and #world again, plus #world/characters')).toEqual([
      'world',
      'world/characters',
    ]);
  });

  it('ignores pure numbers, code fences, and mid-word hashes', () => {
    const body = ['Issue #123 stays', '```', '#not-a-tag', '```', 'real#nope #yes'].join('\n');
    expect(extractHashtags(body)).toEqual(['yes']);
  });
});

describe('snippet (F171)', () => {
  it('skips headings and strips markdown syntax', () => {
    expect(snippet('# Title\n\nSome **bold** and a [link](http://x).')).toBe(
      'Some bold and a link.',
    );
  });

  it('strips list markers and clamps long text', () => {
    expect(snippet('- [x] do the thing')).toBe('do the thing');
    expect(snippet(`${'a'.repeat(200)}`, 50)).toHaveLength(50);
  });

  it('returns empty for empty bodies', () => {
    expect(snippet('# Only a heading\n')).toBe('');
  });
});

describe('word count + reading time (F193)', () => {
  it('counts words', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('one  two\nthree')).toBe(3);
  });

  it('computes minutes at ~225wpm with a 1-minute floor', () => {
    expect(readingTimeMinutes('')).toBe(0);
    expect(readingTimeMinutes('word')).toBe(1);
    expect(readingTimeMinutes(Array(450).fill('w').join(' '))).toBe(2);
  });
});

describe('formatters', () => {
  it('relativeTime buckets', () => {
    const now = Date.parse('2026-06-12T12:00:00Z');
    expect(relativeTime('2026-06-12T11:59:40Z', now)).toBe('now');
    expect(relativeTime('2026-06-12T11:30:00Z', now)).toBe('30m');
    expect(relativeTime('2026-06-12T06:00:00Z', now)).toBe('6h');
    expect(relativeTime('2026-06-10T12:00:00Z', now)).toBe('2d');
  });

  it('formatBytes', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('exportFilename sanitizes (F195)', () => {
    expect(exportFilename('My: Great/Note?')).toBe('My GreatNote.md');
    expect(exportFilename('   ')).toBe('untitled.md');
  });
});
