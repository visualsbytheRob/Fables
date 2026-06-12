import { isAppError } from '@fables/core';
import { describe, expect, it } from 'vitest';
import { compileFql, parseFql, tokenize } from './index.js';

const NOW = new Date('2026-06-12T12:00:00.000Z');

function fail(q: string): { message: string; position: unknown } {
  try {
    parseFql(q);
  } catch (error) {
    if (isAppError(error)) {
      return { message: error.message, position: error.details?.position };
    }
    throw error;
  }
  throw new Error(`expected "${q}" to fail`);
}

describe('FQL tokenizer (F271)', () => {
  it('splits words, phrases, fields, and parens with positions', () => {
    expect(tokenize('fox "harbor town" tag:animals (a OR b)')).toEqual([
      { type: 'word', value: 'fox', position: 0 },
      { type: 'phrase', value: 'harbor town', position: 4 },
      { type: 'field', name: 'tag', value: 'animals', position: 18 },
      { type: 'lparen', position: 30 },
      { type: 'word', value: 'a', position: 31 },
      { type: 'word', value: 'OR', position: 33 },
      { type: 'word', value: 'b', position: 36 },
      { type: 'rparen', position: 37 },
    ]);
  });

  it('reads quoted and [[bracketed]] field values', () => {
    expect(tokenize('title:"two words" linksto:[[Harbor Town]]')).toEqual([
      { type: 'field', name: 'title', value: 'two words', position: 0 },
      { type: 'field', name: 'linksto', value: 'Harbor Town', position: 18 },
    ]);
  });
});

describe('FQL parser (F272, F274–F277) — AST snapshots (F280)', () => {
  const cases = [
    'fox',
    '"quoted phrase"',
    'fox den', // implicit AND
    'fox AND den',
    'fox OR den',
    'NOT fox',
    'NOT (fox OR den) tag:animals',
    'tag:animals notebook:Inbox',
    'notebook:nb_01HZXW8E2RVQJ4Y6T3M9KDFCAB',
    'title:harbor body:dawn',
    'has:attachment pinned:true pinned:false',
    'linksto:[[Harbor Town]]',
    'created:2026-06 updated:2026-06-12',
    'created:>7d updated:<30d',
    'sort:title',
    'fox sort:created asc',
    '(a b) OR (c NOT d)',
    'tag:#camping', // leading # tolerated
    '',
  ];
  for (const q of cases) {
    it(`parses ${JSON.stringify(q)}`, () => {
      expect(parseFql(q)).toMatchSnapshot();
    });
  }

  it('uppercase operators only — lowercase "or" is a search term', () => {
    const { ast } = parseFql('cats or dogs');
    expect(ast).toEqual({
      type: 'and',
      children: [
        { type: 'text', value: 'cats', phrase: false },
        { type: 'text', value: 'or', phrase: false },
        { type: 'text', value: 'dogs', phrase: false },
      ],
    });
  });

  it('OR binds looser than implicit AND', () => {
    const { ast } = parseFql('a b OR c');
    expect(ast).toMatchObject({
      type: 'or',
      children: [{ type: 'and' }, { type: 'text', value: 'c' }],
    });
  });

  it('sort directive defaults direction per key and warns on duplicates', () => {
    expect(parseFql('sort:updated').sort).toEqual({ key: 'updated', dir: 'desc' });
    expect(parseFql('sort:title').sort).toEqual({ key: 'title', dir: 'asc' });
    expect(parseFql('sort:created asc').sort).toEqual({ key: 'created', dir: 'asc' });
    const dup = parseFql('sort:title sort:created');
    expect(dup.sort).toEqual({ key: 'created', dir: 'desc' });
    expect(dup.warnings).toEqual(['multiple sort directives — the last one wins']);
  });

  it('reports helpful syntax errors with positions (F272)', () => {
    expect(fail('fox "unterminated')).toEqual({
      message: 'FQL syntax error: unterminated quoted phrase',
      position: 4,
    });
    expect(fail('flavor:salty')).toMatchObject({ position: 0 });
    expect(fail('flavor:salty').message).toContain('unknown field "flavor"');
    expect(fail('pinned:maybe').message).toContain('pinned: expects true or false');
    expect(fail('created:junk').message).toContain('invalid date filter');
    expect(fail('has:image').message).toContain('has: supports only "attachment"');
    expect(fail('sort:rev').message).toContain('sort: expects');
    expect(fail(')')).toMatchObject({ position: 0 });
    expect(fail('linksto:[[broken')).toEqual({
      message: 'FQL syntax error: unterminated [[wikilink]]',
      position: 8,
    });
  });

  it('degrades an unparseable trailing clause to a warning + prefix query (F279)', () => {
    const result = parseFql('fox tag:animals OR');
    expect(result.ast).toEqual({
      type: 'and',
      children: [
        { type: 'text', value: 'fox', phrase: false },
        { type: 'tag', value: 'animals' },
      ],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('ignored unparseable clause at position 16');

    const bad = parseFql('fox pinned:maybe');
    expect(bad.ast).toEqual({ type: 'text', value: 'fox', phrase: false });
    expect(bad.warnings[0]).toContain('pinned: expects true or false');
  });

  it('still fails fatally when the very first clause is broken', () => {
    expect(fail('pinned:maybe fox').message).toContain('pinned: expects true or false');
    expect(fail('(fox').message).toContain('missing closing ")"');
  });
});

describe('FQL compiler (F273) — parameterization', () => {
  const compile = (q: string) => compileFql(parseFql(q).ast, NOW);

  it('compiles bare terms to LIKE over title and body', () => {
    expect(compile('fox')).toEqual({
      where: `(n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\')`,
      params: ['%fox%', '%fox%'],
    });
  });

  it('escapes LIKE wildcards in user input', () => {
    expect(compile('"100%_done"').params).toEqual(['%100\\%\\_done%', '%100\\%\\_done%']);
  });

  it('compiles relative and calendar date filters against a fixed now', () => {
    expect(compile('updated:>7d')).toEqual({
      where: 'n.updated_at >= ?',
      params: ['2026-06-05T12:00:00.000Z'],
    });
    expect(compile('created:<30d')).toEqual({
      where: 'n.created_at < ?',
      params: ['2026-05-13T12:00:00.000Z'],
    });
    expect(compile('created:2026-06')).toEqual({
      where: '(n.created_at >= ? AND n.created_at < ?)',
      params: ['2026-06', '2026-07'],
    });
    expect(compile('created:2026-12')).toEqual({
      where: '(n.created_at >= ? AND n.created_at < ?)',
      params: ['2026-12', '2027-01'],
    });
    expect(compile('updated:2026-06-30')).toEqual({
      where: '(n.updated_at >= ? AND n.updated_at < ?)',
      params: ['2026-06-30', '2026-07-01'],
    });
  });

  it('notebook: switches between id equality and name lookup', () => {
    expect(compile('notebook:nb_01HZXW8E2RVQJ4Y6T3M9KDFCAB')).toEqual({
      where: 'n.notebook_id = ?',
      params: ['nb_01HZXW8E2RVQJ4Y6T3M9KDFCAB'],
    });
    expect(compile('notebook:Inbox')).toEqual({
      where: 'n.notebook_id IN (SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE)',
      params: ['Inbox'],
    });
  });

  it('never interpolates user strings into the SQL text', () => {
    const hostile = `tag:x" OR "1"="1 "'; DROP TABLE notes; --" linksto:[[']];DELETE FROM notes;--]]`;
    const { where, params } = compile(hostile);
    expect(where).not.toContain('DROP');
    expect(where).not.toContain('DELETE');
    expect(where).not.toContain('1"="1');
    expect(params.join('\n')).toContain('DROP TABLE notes');
    // The WHERE text is built only from fixed templates: no quotes beyond the
    // ESCAPE clause and SQL string literals we wrote ourselves.
    expect(compile('fox').where).toBe(compile('"; DROP TABLE notes; --"').where);
  });

  it('compiles the empty query to match-all', () => {
    expect(compile('')).toEqual({ where: '1 = 1', params: [] });
  });
});
