/** Pure field-editor logic tests (F603/F604/F607). */
import { describe, expect, it } from 'vitest';
import type { EntityTypeSchema } from '../api/client.js';
import {
  defaultsFor,
  emptyValueFor,
  fieldSummary,
  formatFieldValue,
  parseFieldInput,
  parseListItems,
} from './fieldEditors.js';

describe('parseFieldInput', () => {
  it('parses numbers, treating blank/garbage as null', () => {
    expect(parseFieldInput('number', '42')).toBe(42);
    expect(parseFieldInput('number', '3.5')).toBe(3.5);
    expect(parseFieldInput('number', -7)).toBe(-7);
    expect(parseFieldInput('number', '')).toBeNull();
    expect(parseFieldInput('number', '  ')).toBeNull();
    expect(parseFieldInput('number', 'abc')).toBeNull();
    expect(parseFieldInput('number', Infinity)).toBeNull();
  });

  it('parses booleans from checkbox state and truthy strings', () => {
    expect(parseFieldInput('bool', true)).toBe(true);
    expect(parseFieldInput('bool', false)).toBe(false);
    expect(parseFieldInput('bool', 'true')).toBe(true);
    expect(parseFieldInput('bool', '1')).toBe(true);
    expect(parseFieldInput('bool', 'yes')).toBe(true);
    expect(parseFieldInput('bool', 'no')).toBe(false);
    expect(parseFieldInput('bool', '')).toBe(false);
  });

  it('passes strings through unchanged', () => {
    expect(parseFieldInput('string', 'Aragorn')).toBe('Aragorn');
    expect(parseFieldInput('string', '')).toBe('');
    expect(parseFieldInput('string', '  spaced  ')).toBe('  spaced  ');
  });

  it('parses lists, promoting all-numeric lists to number[]', () => {
    expect(parseFieldInput('list', 'a, b, c')).toEqual(['a', 'b', 'c']);
    expect(parseFieldInput('list', 'a\nb\nc')).toEqual(['a', 'b', 'c']);
    expect(parseFieldInput('list', '1, 2, 3')).toEqual([1, 2, 3]);
    expect(parseFieldInput('list', '10\n20')).toEqual([10, 20]);
    expect(parseFieldInput('list', '1, two, 3')).toEqual(['1', 'two', '3']);
    expect(parseFieldInput('list', '')).toEqual([]);
    expect(parseFieldInput('list', ' , , ')).toEqual([]);
  });
});

describe('parseListItems', () => {
  it('trims and drops blanks across commas and newlines', () => {
    expect(parseListItems(' a , ,b\n c ')).toEqual(['a', 'b', 'c']);
    expect(parseListItems(['x', ' ', 'y'])).toEqual(['x', 'y']);
    expect(parseListItems('')).toEqual([]);
  });
});

describe('formatFieldValue', () => {
  it('formats primitives, lists, and nullish values', () => {
    expect(formatFieldValue(7)).toBe('7');
    expect(formatFieldValue('hi')).toBe('hi');
    expect(formatFieldValue(true)).toBe('true');
    expect(formatFieldValue(false)).toBe('false');
    expect(formatFieldValue(['a', 'b'])).toBe('a, b');
    expect(formatFieldValue([1, 2, 3])).toBe('1, 2, 3');
    expect(formatFieldValue(null)).toBe('');
    expect(formatFieldValue(undefined)).toBe('');
  });
});

describe('emptyValueFor', () => {
  it('returns the neutral value per field type', () => {
    expect(emptyValueFor('number')).toBeNull();
    expect(emptyValueFor('bool')).toBe(false);
    expect(emptyValueFor('list')).toEqual([]);
    expect(emptyValueFor('string')).toBe('');
  });
});

const schema: EntityTypeSchema = {
  type: 'character',
  fields: [
    { name: 'level', fieldType: 'number', default: 1 },
    { name: 'title', fieldType: 'string' },
    { name: 'alive', fieldType: 'bool', default: true },
    { name: 'tags', fieldType: 'list', default: ['hero'] },
    { name: 'hp', fieldType: 'number' },
  ],
  relations: [{ name: 'allies', targetType: 'character' }],
  updatedAt: '2026-06-13T00:00:00.000Z',
};

describe('defaultsFor', () => {
  it('seeds a create form from schema defaults, filling neutral empties', () => {
    expect(defaultsFor(schema)).toEqual({
      level: 1,
      title: '',
      alive: true,
      tags: ['hero'],
      hp: null,
    });
  });

  it('returns an empty record for a schema with no fields', () => {
    expect(defaultsFor({ ...schema, fields: [] })).toEqual({});
  });
});

describe('fieldSummary', () => {
  it('summarises the first non-empty fields up to the limit', () => {
    const summary = fieldSummary(
      { level: 5, title: 'Ranger', alive: true, tags: ['hero', 'king'] },
      schema.fields,
    );
    expect(summary).toBe('level: 5 · title: Ranger · alive: true');
  });

  it('skips empty and false-valued fields', () => {
    expect(fieldSummary({ level: 0, title: '', alive: false, hp: 12 }, schema.fields)).toBe(
      'level: 0 · hp: 12',
    );
  });
});
