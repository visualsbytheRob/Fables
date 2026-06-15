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
      '005-links',
      '006-saved-queries',
      '007-import-jobs',
      '008-story-projects',
      '009-entities',
      '010-world',
      '011-fts',
      '012-embeddings',
      '013-ingest-jobs',
      '014-sync',
      '015-analytics',
      '016-plugins',
      '017-plugin-distribution',
      '018-crdt',
      '019-shares',
      '020-vault',
      '021-security-audit',
      '022-compliance',
      '023-retention',
      '024-ai-usage',
      '025-ai-actions',
      '026-ai-settings',
      '027-import-framework',
      '028-canvas',
      '029-canvas-edges',
      '030-tts',
      '031-casting',
      '032-audio-settings',
      '033-recording-takes',
      '034-playback',
      '035-cards',
      '036-decks',
      '037-learning-settings',
      '038-feedback',
      '039-generated-assets',
      '040-automation',
      '041-jobs',
      '042-vaults',
      '043-webhooks',
      '044-bulk-journal',
      '045-scripts',
      '046-profiles',
      '047-ai-runtime',
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
