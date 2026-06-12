import { describe, expect, it } from 'vitest';
import { formatFrontmatter, parseFrontmatter } from './frontmatter.js';

describe('parseFrontmatter (F293)', () => {
  it('parses scalars, booleans, and quoted values', () => {
    const doc = [
      '---',
      'title: Harbor Town',
      'created: 2024-01-02T03:04:05.000Z',
      'pinned: true',
      'quoted: "a: colon value"',
      "single: 'spaced  out'",
      '---',
      '# Body',
      '',
    ].join('\n');
    const { data, body } = parseFrontmatter(doc);
    expect(data).toEqual({
      title: 'Harbor Town',
      created: '2024-01-02T03:04:05.000Z',
      pinned: true,
      quoted: 'a: colon value',
      single: 'spaced  out',
    });
    expect(body).toBe('# Body\n');
  });

  it('parses inline and block lists', () => {
    const doc = [
      '---',
      'tags: [travel, sea-life, "two words"]',
      'aliases:',
      '  - HT',
      '  - The Harbor',
      'empty:',
      '---',
      'body',
    ].join('\n');
    const { data } = parseFrontmatter(doc);
    expect(data.tags).toEqual(['travel', 'sea-life', 'two words']);
    expect(data.aliases).toEqual(['HT', 'The Harbor']);
    expect(data.empty).toBe('');
  });

  it('returns the document untouched without a frontmatter block', () => {
    expect(parseFrontmatter('# Just a note')).toEqual({ data: {}, body: '# Just a note' });
    expect(parseFrontmatter('--- not frontmatter')).toEqual({
      data: {},
      body: '--- not frontmatter',
    });
    const unclosed = '---\ntitle: dangling\nbody text';
    expect(parseFrontmatter(unclosed)).toEqual({ data: {}, body: unclosed });
  });

  it('skips lines it does not understand instead of failing', () => {
    const doc = ['---', 'title: Ok', 'nested:', '  deep: object', 'weird !! line', '---', 'b'].join(
      '\n',
    );
    const { data } = parseFrontmatter(doc);
    expect(data.title).toBe('Ok');
    expect(data.nested).toBe('');
  });
});

describe('formatFrontmatter (F295)', () => {
  it('round-trips through parseFrontmatter', () => {
    const block = formatFrontmatter({
      title: 'Notes: a study',
      tags: ['travel', 'sea'],
      created: '2024-01-02T03:04:05.000Z',
      pinned: true,
      skipped: undefined,
    });
    const { data, body } = parseFrontmatter(`${block}the body`);
    expect(data).toEqual({
      title: 'Notes: a study',
      tags: ['travel', 'sea'],
      created: '2024-01-02T03:04:05.000Z',
      pinned: true,
    });
    expect(body).toBe('the body');
  });

  it('returns an empty string when there is nothing to write', () => {
    expect(formatFrontmatter({})).toBe('');
    expect(formatFrontmatter({ tags: [] })).toBe('');
  });
});
