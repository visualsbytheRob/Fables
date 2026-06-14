/**
 * Per-notebook retention + legal-hold interaction tests (F1283, F1286).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { legalHoldRepo } from './legal-hold.js';
import { retentionRepo } from './retention.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

/** Force a note's updated_at to an explicit ISO timestamp. */
function setUpdatedAt(db: ReturnType<typeof openDb>, noteId: string, iso: string) {
  db.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(iso, noteId);
}

const longAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();

describe('notebook retention (F1283)', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it('set / get / listConfigured round-trip', () => {
    const nb = notebooksRepo(db).create({ name: 'NB' });
    expect(retentionRepo(db).get(nb.id)).toEqual({ notebookId: nb.id, retentionDays: null });
    retentionRepo(db).set(nb.id, 30);
    expect(retentionRepo(db).get(nb.id)).toEqual({ notebookId: nb.id, retentionDays: 30 });
    expect(retentionRepo(db).listConfigured()).toEqual([{ notebookId: nb.id, retentionDays: 30 }]);
    retentionRepo(db).set(nb.id, null);
    expect(retentionRepo(db).listConfigured()).toEqual([]);
  });

  it('set on an unknown notebook throws', () => {
    expect(() => retentionRepo(db).set('nb_does_not_exist', 30)).toThrow();
  });

  it('purges only notes older than the window, keeps fresh ones', () => {
    const nb = notebooksRepo(db).create({ name: 'Retained' });
    retentionRepo(db).set(nb.id, 30);
    const old = notesRepo(db).create({ notebookId: nb.id, title: 'old', body: 'x' });
    const fresh = notesRepo(db).create({ notebookId: nb.id, title: 'fresh', body: 'y' });
    setUpdatedAt(db, old.id, longAgo);

    expect(retentionRepo(db).countExpired(nb.id, 30)).toBe(1);
    const result = retentionRepo(db).purge();
    expect(result.purged).toBe(1);
    expect(result.blockedByLegalHold).toBe(false);
    expect(notesRepo(db).get(old.id)).toBeNull();
    expect(notesRepo(db).get(fresh.id)).not.toBeNull();
  });

  it('does not touch notebooks without a retention window', () => {
    const nb = notebooksRepo(db).create({ name: 'No policy' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 'keep', body: 'z' });
    setUpdatedAt(db, note.id, longAgo);
    expect(retentionRepo(db).purge().purged).toBe(0);
    expect(notesRepo(db).get(note.id)).not.toBeNull();
  });

  it('is blocked entirely while a legal hold is active (F1286)', () => {
    const nb = notebooksRepo(db).create({ name: 'Held' });
    retentionRepo(db).set(nb.id, 30);
    const old = notesRepo(db).create({ notebookId: nb.id, title: 'old', body: 'x' });
    setUpdatedAt(db, old.id, longAgo);

    legalHoldRepo(db).set(true);
    const result = retentionRepo(db).purge();
    expect(result).toEqual({ purged: 0, blockedByLegalHold: true, byNotebook: [] });
    expect(notesRepo(db).get(old.id)).not.toBeNull(); // nothing destroyed under hold

    // Lifting the hold lets the purge proceed.
    legalHoldRepo(db).set(false);
    expect(retentionRepo(db).purge().purged).toBe(1);
  });
});
