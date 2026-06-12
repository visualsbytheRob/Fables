import { describe, expect, it } from 'vitest';
import { extractHashtags, isValidTagName, normalizeTagName, rewriteHashtag } from './hashtags.js';

describe('extractHashtags', () => {
  it('finds tags, normalizes case, and dedupes', () => {
    expect(extractHashtags('A note about #Foxes and #foxes, plus #magic.')).toEqual([
      'foxes',
      'magic',
    ]);
  });

  it('supports nested tags', () => {
    expect(extractHashtags('see #world/characters and #world')).toEqual([
      'world/characters',
      'world',
    ]);
  });

  it('ignores markdown headings and pure-number refs', () => {
    expect(extractHashtags('# Heading\n## Sub\nissue #123 fixed')).toEqual([]);
  });

  it('ignores url fragments and mid-word hashes', () => {
    expect(extractHashtags('https://example.com/page#section and foo#bar')).toEqual([]);
  });

  it('ignores tags inside fenced code blocks', () => {
    const body = ['#real', '```js', 'const x = "#fake";', '```', '#also-real'].join('\n');
    expect(extractHashtags(body)).toEqual(['real', 'also-real']);
  });

  it('handles tilde fences and fence chars inside other fences', () => {
    const body = ['~~~', '#fake', '```', '#still-fake', '~~~', '#real'].join('\n');
    expect(extractHashtags(body)).toEqual(['real']);
  });
});

describe('rewriteHashtag', () => {
  it('rewrites case-insensitively at word boundaries only', () => {
    expect(
      rewriteHashtag('#World and #world! but not #world/sub or #worldly', 'world', 'realm'),
    ).toBe('#realm and #realm! but not #world/sub or #worldly');
  });

  it('leaves fenced code blocks untouched', () => {
    const body = ['#old', '```', '#old', '```'].join('\n');
    expect(rewriteHashtag(body, 'old', 'new')).toBe(['#new', '```', '#old', '```'].join('\n'));
  });
});

describe('tag name normalization', () => {
  it('normalizes user input', () => {
    expect(normalizeTagName('  #World/Characters ')).toBe('world/characters');
  });

  it('validates normalized names', () => {
    expect(isValidTagName('world/characters')).toBe(true);
    expect(isValidTagName('with-dash_under')).toBe(true);
    expect(isValidTagName('bad tag')).toBe(false);
    expect(isValidTagName('123')).toBe(false);
    expect(isValidTagName('trailing/')).toBe(false);
    expect(isValidTagName('')).toBe(false);
  });
});
