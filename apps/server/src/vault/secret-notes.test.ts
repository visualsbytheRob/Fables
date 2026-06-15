/**
 * Secret-notes service tests (Epic 13, F1241–F1250, F1213).
 */

import { isEncryptedField, type NotebookId } from '@fables/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { runFqlQuery } from '../services/query.js';
import { SecretNotesService, isSecretHidden } from './secret-notes.js';

let db: ReturnType<typeof openDb>;
let notebookId: string;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  notebookId = notebooksRepo(db).create({ name: 'Private' }).id;
});

afterEach(() => {
  db.close();
});

function makeNote(title: string, body: string): string {
  return notesRepo(db).create({ notebookId: notebookId as NotebookId, title, body }).id;
}

describe('secret box lifecycle (F1241/F1242)', () => {
  it('creates, locks and unlocks on an independent key path', async () => {
    const svc = new SecretNotesService(db);
    expect(svc.status()).toBe('absent');
    await svc.create('secret-pass', 'interactive');
    expect(svc.status()).toBe('unlocked');
    svc.lock();
    expect(svc.status()).toBe('locked');
    await svc.unlock('secret-pass');
    expect(svc.status()).toBe('unlocked');
  });

  it('rejects a wrong secret passphrase', async () => {
    const svc = new SecretNotesService(db);
    await svc.create('right-pass', 'interactive');
    svc.lock();
    await expect(svc.unlock('wrong-pass')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('marking notes secret (F1241/F1244/F1245)', () => {
  it('encrypts a note and hides it from normal search, then reveals it', async () => {
    const id = makeNote('Bank PIN', 'the code is 1234');
    const svc = new SecretNotesService(db);
    await svc.create('pass', 'interactive');

    expect(svc.markSecret(id)).toBe(true);
    // Stored fields are now ciphertext.
    const row = db.prepare('SELECT title, body, secret FROM notes WHERE id = ?').get(id) as {
      title: string;
      body: string;
      secret: number;
    };
    expect(row.secret).toBe(1);
    expect(isEncryptedField(row.title)).toBe(true);
    expect(isEncryptedField(row.body)).toBe(true);

    // Excluded from FQL search (F1244).
    const { notes } = runFqlQuery(db, 'code', { fetch: 50, cursor: null });
    expect(notes.find((n) => n.id === id)).toBeUndefined();

    // Reveal decrypts the original plaintext.
    expect(svc.reveal(id)).toEqual({ title: 'Bank PIN', body: 'the code is 1234' });

    // Unmark restores plaintext + clears the flag.
    expect(svc.unmarkSecret(id)).toBe(true);
    const after = db.prepare('SELECT title, secret FROM notes WHERE id = ?').get(id) as {
      title: string;
      secret: number;
    };
    expect(after.secret).toBe(0);
    expect(after.title).toBe('Bank PIN');
  });

  it('bulk converts notes to secret', async () => {
    const a = makeNote('A', 'aaa');
    const b = makeNote('B', 'bbb');
    const svc = new SecretNotesService(db);
    await svc.create('pass', 'interactive');
    expect(svc.bulkConvert([a, b], true)).toBe(2);
    expect(svc.isNoteSecret(a)).toBe(true);
    expect(svc.secretNoteIds().size).toBe(2);
  });

  it('refuses to operate when locked (F1248)', async () => {
    const id = makeNote('X', 'y');
    const svc = new SecretNotesService(db);
    await svc.create('pass', 'interactive');
    svc.lock();
    expect(() => svc.markSecret(id)).toThrowError(/locked/);
    expect(() => svc.reveal(id)).toThrowError(/locked/);
  });
});

describe('independent session timeout (F1248)', () => {
  it('auto-locks after the idle window elapses', async () => {
    let clock = 1_000_000;
    const svc = new SecretNotesService(db, 60_000, () => clock);
    await svc.create('pass', 'interactive');
    expect(svc.isUnlocked()).toBe(true);
    clock += 30_000;
    expect(svc.isUnlocked()).toBe(true); // within window, refreshes activity
    clock += 61_000;
    expect(svc.isUnlocked()).toBe(false); // idle past the timeout → locked
    expect(svc.status()).toBe('locked');
  });
});

describe('encrypted in-memory FTS (F1213)', () => {
  it('searches secret notes only while unlocked', async () => {
    const id = makeNote('Treasure map', 'buried beneath the old oak tree');
    const svc = new SecretNotesService(db);
    await svc.create('pass', 'interactive');
    svc.markSecret(id);

    const hits = svc.search('oak tree');
    expect(hits[0]?.id).toBe(id);

    // Lock drops the index entirely — nothing searchable.
    svc.lock();
    expect(svc.search('oak tree')).toEqual([]);

    // Unlock rebuilds the index from the decrypted notes.
    await svc.unlock('pass');
    expect(svc.search('oak').map((h) => h.id)).toContain(id);
  });
});

describe('isSecretHidden policy (F1244/F1249)', () => {
  it('hides a flagged note when locked, shows it when unlocked', () => {
    expect(isSecretHidden({ secret: 1, title: 'enc:v1:x', body: 'enc:v1:y' }, false)).toBe(true);
    expect(isSecretHidden({ secret: false, title: 'plain', body: 'text' }, false)).toBe(false);
    // Defensive: any encrypted field is hidden regardless of the flag.
    expect(isSecretHidden({ secret: false, title: 'enc:v1:z', body: 'b' }, true)).toBe(true);
  });
});
