import { describe, expect, it } from 'vitest';
import {
  completeFql,
  EMBED_DEFAULT_RESULTS,
  EMBED_MAX_RESULTS,
  highlightFql,
  parseEmbedBlock,
} from './fql.js';

describe('highlightFql (F278)', () => {
  it('segments concatenate back to the exact input', () => {
    const q = 'tag:reading AND (title:"the fox" OR linksto:[[A Note]]) sort:updated desc';
    expect(
      highlightFql(q)
        .map((s) => s.text)
        .join(''),
    ).toBe(q);
  });

  it('classifies fields, values, operators, phrases and parens', () => {
    const segs = highlightFql('tag:fox AND NOT (pinned:true "old tale")');
    const kindOf = (text: string) => segs.find((s) => s.text === text)?.kind;
    expect(kindOf('tag:')).toBe('field');
    expect(kindOf('fox')).toBe('value');
    expect(kindOf('AND')).toBe('operator');
    expect(kindOf('NOT')).toBe('operator');
    expect(kindOf('(')).toBe('paren');
    expect(kindOf('pinned:')).toBe('field');
    expect(kindOf('true')).toBe('value');
    expect(kindOf('"old tale"')).toBe('phrase');
  });

  it('treats unknown field names and bare words as plain text', () => {
    const segs = highlightFql('bogus:x fable');
    expect(segs.find((s) => s.text === 'bogus:')?.kind).toBe('text');
    expect(segs.find((s) => s.text === 'fable')?.kind).toBe('text');
  });

  it('survives unterminated quotes without changing the text', () => {
    const q = 'title:"unterminated';
    expect(
      highlightFql(q)
        .map((s) => s.text)
        .join(''),
    ).toBe(q);
  });
});

describe('completeFql (F278)', () => {
  it('suggests field names for a partial word', () => {
    const completion = completeFql('ta', 2);
    expect(completion?.options.map((o) => o.label)).toContain('tag:');
    expect(completion?.from).toBe(0);
    expect(completion?.to).toBe(2);
  });

  it('suggests all fields at the start of a new clause', () => {
    const completion = completeFql('tag:fox ', 8);
    expect(completion?.options.map((o) => o.label)).toContain('sort:');
    expect(completion?.options.map((o) => o.label)).toContain('notebook:');
  });

  it('suggests enum values after sort:/pinned:/has:', () => {
    expect(completeFql('sort:', 5)?.options.map((o) => o.label)).toEqual([
      'updated',
      'created',
      'title',
    ]);
    expect(completeFql('pinned:t', 8)?.options.map((o) => o.label)).toEqual(['true']);
    expect(completeFql('has:', 4)?.options.map((o) => o.label)).toEqual(['attachment']);
  });

  it('offers nothing after free-value fields or mid-word', () => {
    expect(completeFql('tag:rea', 7)).toBeNull();
    expect(completeFql('zzz', 3)).toBeNull();
  });
});

describe('parseEmbedBlock (F283–F285, F289)', () => {
  it('defaults to list mode with the default cap', () => {
    const block = parseEmbedBlock('tag:reading');
    expect(block).toEqual({
      query: 'tag:reading',
      mode: 'list',
      limit: EMBED_DEFAULT_RESULTS,
      errors: [],
    });
  });

  it('parses mode and limit directives ahead of the query', () => {
    const block = parseEmbedBlock('mode: table\nlimit: 5\ntag:reading sort:updated desc');
    expect(block.mode).toBe('table');
    expect(block.limit).toBe(5);
    expect(block.query).toBe('tag:reading sort:updated desc');
  });

  it('supports count mode', () => {
    expect(parseEmbedBlock('mode: count\npinned:true').mode).toBe('count');
  });

  it('caps the limit (F289)', () => {
    const block = parseEmbedBlock(`limit: 9999\ntag:x`);
    expect(block.limit).toBe(EMBED_MAX_RESULTS);
    expect(block.errors[0]).toContain('capped');
  });

  it('reports unknown modes and bad limits without dropping the query', () => {
    const block = parseEmbedBlock('mode: pie\nlimit: nope\ntag:x');
    expect(block.errors).toHaveLength(2);
    expect(block.query).toBe('tag:x');
  });

  it('stops treating lines as directives once the query starts', () => {
    const block = parseEmbedBlock('tag:x\nmode: table');
    expect(block.mode).toBe('list');
    expect(block.query).toBe('tag:x\nmode: table');
  });
});
