import { describe, expect, it } from 'vitest';
import { AppError } from '@fables/core';
import { openDb, withTransaction } from './connection.js';
import { integrityCheck } from './maintenance.js';
import { migrate } from './migrate.js';
import { notebooksRepo } from './repos/notebooks.js';
import { notesRepo } from './repos/notes.js';
import { seed } from './seed.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

describe('migrations', () => {
  it('applies all migrations once, then is a no-op', () => {
    const db = openDb(':memory:');
    expect(migrate(db).applied).toEqual([
      '001-notes',
      '002-stories',
      '003-note-revisions',
      '004-attachments',
    ]);
    expect(migrate(db).applied).toEqual([]);
  });

  it('enables WAL-equivalent and foreign keys', () => {
    const db = freshDb();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('passes integrity check', () => {
    expect(integrityCheck(freshDb())).toEqual([]);
  });
});

describe('notes repo', () => {
  it('creates and fetches notes', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 'Hello', body: 'world' });
    expect(notesRepo(db).get(note.id)).toEqual(note);
  });

  it('enforces optimistic concurrency on update', () => {
    const db = freshDb();
    const repo = notesRepo(db);
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = repo.create({ notebookId: nb.id, title: 'v0' });

    const updated = repo.update(note.id, 0, { title: 'v1' });
    expect(updated.rev).toBe(1);
    expect(() => repo.update(note.id, 0, { title: 'stale write' })).toThrowError(AppError);
    try {
      repo.update(note.id, 0, { title: 'stale write' });
    } catch (e) {
      expect((e as AppError).code).toBe('CONFLICT');
    }
  });

  it('trashes, hides from listings, and restores', () => {
    const db = freshDb();
    const repo = notesRepo(db);
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = repo.create({ notebookId: nb.id, title: 'doomed' });

    repo.trash(note.id);
    expect(repo.listByNotebook(nb.id)).toHaveLength(0);
    expect(repo.listByNotebook(nb.id, { includeTrashed: true })).toHaveLength(1);

    repo.restore(note.id);
    expect(repo.listByNotebook(nb.id)).toHaveLength(1);
    expect(() => repo.restore(note.id)).toThrowError(AppError);
  });

  it('rejects notes in nonexistent notebooks (foreign keys on)', () => {
    const db = freshDb();
    expect(() =>
      notesRepo(db).create({ notebookId: 'nb_00000000000000000000000000' as never }),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('transactions', () => {
  it('rolls back everything when the function throws', () => {
    const db = freshDb();
    const notebooks = notebooksRepo(db);
    expect(() =>
      withTransaction(db, () => {
        notebooks.create({ name: 'will vanish' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(notebooks.list()).toHaveLength(0);
  });
});

describe('seed', () => {
  it('seeds a fresh vault exactly once', () => {
    const db = freshDb();
    expect(seed(db).seeded).toBe(true);
    expect(notesRepo(db).count()).toBe(2);
    expect(seed(db).seeded).toBe(false);
    expect(notesRepo(db).count()).toBe(2);
  });
});
