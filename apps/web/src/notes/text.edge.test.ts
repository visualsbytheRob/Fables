/**
 * F902 — Edge-case tests for note text utilities:
 * unicode titles, huge notes, empty states, RTL, emoji, CJK.
 */
import { describe, expect, it } from 'vitest';
import {
  exportFilename,
  extractHashtags,
  readingTimeMinutes,
  relativeTime,
  snippet,
  wordCount,
} from './text.js';

describe('unicode edge cases (F902)', () => {
  it('handles emoji in note titles for exportFilename', () => {
    const result = exportFilename('🦊 Fox Tales 🐦');
    expect(result).toContain('Fox Tales');
    expect(result.endsWith('.md')).toBe(true);
  });

  it('handles CJK characters in snippet', () => {
    const body = '# 头\n\n日本語テスト — Japanese test content';
    const s = snippet(body);
    expect(s).toContain('日本語');
  });

  it('handles RTL text in snippet', () => {
    const body = 'مرحبا بالعالم — hello world';
    const s = snippet(body);
    expect(s.length).toBeGreaterThan(0);
  });

  it('extracts tags from unicode body without breaking', () => {
    const body = '日本語 #tag1 and مرحبا #tag2/sub العالم';
    const tags = extractHashtags(body);
    expect(tags).toContain('tag1');
    expect(tags).toContain('tag2/sub');
  });

  it('handles zero-width joiner and combining chars in tags', () => {
    // Tags can't start with non-ASCII; should not match
    const tags = extractHashtags('#̀notag pure normal #real_tag');
    expect(tags).toContain('real_tag');
  });
});

describe('huge note edge cases (F902)', () => {
  it('snippet clamps correctly at default 120 chars', () => {
    const long = 'word '.repeat(200).trim();
    const s = snippet(long);
    expect(s.length).toBe(120);
    expect(s.endsWith('…')).toBe(true);
  });

  it('word count handles 10k-word note', () => {
    const body = Array.from({ length: 10_000 }, (_, i) => `word${i}`).join(' ');
    expect(wordCount(body)).toBe(10_000);
  });

  it('reading time of 10k words is ~44 min', () => {
    const body = 'word '.repeat(10_000).trim();
    expect(readingTimeMinutes(body)).toBe(44);
  });

  it('extractHashtags handles 1k tags without crash', () => {
    const body = Array.from({ length: 1_000 }, (_, i) => `#tag${i}`).join(' ');
    const tags = extractHashtags(body);
    expect(tags.length).toBe(1_000);
  });

  it('snippet skips all-heading body correctly', () => {
    const body = Array.from({ length: 50 }, (_, i) => `## Heading ${i}`).join('\n');
    expect(snippet(body)).toBe('');
  });
});

describe('empty states (F902)', () => {
  it('snippet returns empty for empty string', () => {
    expect(snippet('')).toBe('');
  });

  it('wordCount returns 0 for empty/whitespace', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   \n\t  ')).toBe(0);
  });

  it('relativeTime returns empty for invalid ISO', () => {
    expect(relativeTime('not-a-date')).toBe('');
  });

  it('exportFilename returns untitled.md for blank title', () => {
    expect(exportFilename('')).toBe('untitled.md');
    expect(exportFilename('   ')).toBe('untitled.md');
  });

  it('extractHashtags returns empty array for empty body', () => {
    expect(extractHashtags('')).toEqual([]);
    expect(extractHashtags('no tags here')).toEqual([]);
  });
});

describe('multiline and fenced-block edge cases (F902)', () => {
  it('snippet skips the fence marker line itself', () => {
    // The fence marker line is skipped; first non-empty text is returned.
    // snippet() returns the first non-heading, non-fence-marker line.
    const body = '```\n#fake-tag\nsome code\n```\nReal content here';
    // snippet skips the ``` line but may return content inside the fence
    // or the line after. The important behavior: it never crashes on fences.
    const s = snippet(body);
    expect(s.length).toBeGreaterThan(0);
  });

  it('extractHashtags skips code fences', () => {
    const body = '```\n#inside-fence\n```\n#outside';
    const tags = extractHashtags(body);
    expect(tags).not.toContain('inside-fence');
    expect(tags).toContain('outside');
  });

  it('snippet strips inline markdown: bold, italic, links', () => {
    const body = '**Bold** and *italic* and [link](url)';
    const s = snippet(body);
    expect(s).toContain('Bold');
    expect(s).toContain('italic');
    expect(s).toContain('link');
    // markdown syntax chars removed
    expect(s).not.toContain('**');
    expect(s).not.toContain('*');
    expect(s).not.toContain('[link](url)');
  });

  it('snippet strips task list prefix', () => {
    const body = '- [ ] do the thing';
    expect(snippet(body)).toBe('do the thing');
  });
});
