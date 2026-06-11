import { describe, expect, it } from 'vitest';
import { addDays, dayKey, formatRelative, parseDayKey } from './dates.js';
import { AppError, isAppError, notFound, validation } from './errors.js';
import { isId, newEntityId, newNoteId } from './ids.js';
import { all, andThen, err, map, ok, unwrapOr } from './result.js';
import { entitySchema, noteSchema, tagSchema } from './schemas.js';
import { slugify, titleFromBody, uniqueSlug } from './slug.js';

describe('ids', () => {
  it('generates prefixed, unique, well-formed ids', () => {
    const a = newNoteId();
    const b = newNoteId();
    expect(a).not.toBe(b);
    expect(isId(a, 'note')).toBe(true);
    expect(isId(a, 'ent')).toBe(false);
    expect(isId('garbage')).toBe(false);
  });

  it('ids are lexicographically sortable by creation time', () => {
    const first = newNoteId();
    const second = newNoteId();
    expect(first <= second).toBe(true);
  });
});

describe('result', () => {
  it('maps and chains', () => {
    const r = andThen(
      map(ok(2), (n) => n * 3),
      (n) => (n === 6 ? ok('six') : err('nope')),
    );
    expect(r).toEqual({ ok: true, value: 'six' });
  });

  it('short-circuits on error', () => {
    const r = map(err('boom'), () => 'never');
    expect(unwrapOr(r, 'fallback')).toBe('fallback');
  });

  it('collects arrays, failing fast', () => {
    expect(all([ok(1), ok(2)])).toEqual({ ok: true, value: [1, 2] });
    expect(all([ok(1), err('x'), ok(3)])).toEqual({ ok: false, error: 'x' });
  });
});

describe('errors', () => {
  it('carries stable codes and serializes safely', () => {
    const e = notFound('Note', 'note_123');
    expect(e.code).toBe('NOT_FOUND');
    expect(e.toJSON()).toEqual({
      code: 'NOT_FOUND',
      message: 'Note not found',
      details: { id: 'note_123' },
    });
    expect(isAppError(e)).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
  });

  it('validation helper attaches details', () => {
    const e = validation('bad title', { field: 'title' });
    expect(e).toBeInstanceOf(AppError);
    expect(e.details).toEqual({ field: 'title' });
  });
});

describe('dates', () => {
  it('round-trips day keys', () => {
    const d = new Date(2026, 5, 11);
    expect(dayKey(d)).toBe('2026-06-11');
    expect(dayKey(parseDayKey('2026-06-11'))).toBe('2026-06-11');
    expect(() => parseDayKey('june 11')).toThrow(RangeError);
  });

  it('adds days across month boundaries', () => {
    expect(dayKey(addDays(new Date(2026, 0, 31), 1))).toBe('2026-02-01');
  });

  it('formats relative times in both directions', () => {
    const now = new Date('2026-06-11T12:00:00Z');
    expect(formatRelative('2026-06-11T11:59:58Z', now)).toBe('just now');
    expect(formatRelative('2026-06-11T11:55:00Z', now)).toBe('5 minutes ago');
    expect(formatRelative('2026-06-09T12:00:00Z', now)).toBe('2 days ago');
    expect(formatRelative('2026-06-11T14:00:00Z', now)).toBe('in 2 hours');
  });
});

describe('slug', () => {
  it('handles unicode, punctuation, and emptiness', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('Crème Brûlée — recette')).toBe('creme-brulee-recette');
    expect(slugify('  ---  ')).toBe('untitled');
    expect(slugify('日本語ノート')).toBe('日本語ノート');
  });

  it('suffixes collisions', () => {
    const taken = new Set(['my-note', 'my-note-2']);
    expect(uniqueSlug('My Note', taken)).toBe('my-note-3');
    expect(uniqueSlug('Fresh', taken)).toBe('fresh');
  });

  it('derives titles from bodies', () => {
    expect(titleFromBody('## The Fox\nand the crow')).toBe('The Fox');
    expect(titleFromBody('\n\n  \n')).toBe('Untitled');
  });
});

describe('schemas', () => {
  const now = new Date().toISOString();

  it('round-trips a valid note', () => {
    const note = {
      id: newNoteId(),
      notebookId: 'nb_01HZXJ5W7N2M4Q6R8T0V2X4Z6A',
      title: 'The Fox',
      body: 'sly',
      pinned: false,
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
      rev: 0,
    };
    expect(noteSchema.parse(note)).toEqual(note);
  });

  it('rejects malformed ids and tag names', () => {
    expect(tagSchema.safeParse({ id: 'tag_short', name: 'x', color: null, createdAt: now }).success).toBe(false);
    expect(
      tagSchema.safeParse({ id: newEntityId(), name: 'has space', color: null, createdAt: now })
        .success,
    ).toBe(false);
  });

  it('validates entities with aliases and fields', () => {
    const entity = {
      id: newEntityId(),
      type: 'character' as const,
      name: 'Reynard',
      aliases: ['The Fox', 'Sly One'],
      fields: { health: 100, traits: ['cunning'] },
      noteId: null,
      createdAt: now,
      updatedAt: now,
    };
    expect(entitySchema.parse(entity)).toEqual(entity);
  });
});
