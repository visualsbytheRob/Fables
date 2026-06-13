/**
 * At-rest note encryption integration (F1211).
 *
 * Proves that, with an unlocked vault's field codec, note titles and bodies are
 * stored as ciphertext in SQLite and transparently decrypted on read — while a
 * plaintext repo (no codec) sees only ciphertext, confirming the data on disk
 * carries no plaintext.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { VaultService } from './service.js';

async function setup() {
  const db = openDb(':memory:');
  migrate(db);
  const vault = new VaultService(db);
  await vault.create('vault-pass', 'interactive');
  const codec = vault.fieldCodec();
  if (!codec) throw new Error('codec should exist when unlocked');
  const nb = notebooksRepo(db).create({ name: 'Secret' });
  return { db, vault, codec, nb };
}

describe('note encryption at rest (F1211)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('stores ciphertext on disk but reads back plaintext', async () => {
    const { db, codec, nb } = ctx;
    const repo = notesRepo(db, codec);
    const note = repo.create({
      notebookId: nb.id,
      title: 'The Dragon Vault',
      body: 'The treasure is behind the third stone.',
    });

    // Raw row: ciphertext, no plaintext leak.
    const raw = db.prepare('SELECT title, body FROM notes WHERE id = ?').get(note.id) as {
      title: string;
      body: string;
    };
    expect(raw.title.startsWith('enc:v1:')).toBe(true);
    expect(raw.body.startsWith('enc:v1:')).toBe(true);
    expect(raw.title).not.toContain('Dragon');
    expect(raw.body).not.toContain('treasure');

    // Through the codec repo: transparent plaintext.
    const read = repo.get(note.id)!;
    expect(read.title).toBe('The Dragon Vault');
    expect(read.body).toBe('The treasure is behind the third stone.');
  });

  it('a plaintext repo (no codec) sees only ciphertext — nothing readable on disk', () => {
    const { db, codec, nb } = ctx;
    const note = notesRepo(db, codec).create({
      notebookId: nb.id,
      title: 'Hidden',
      body: 'classified',
    });
    const plain = notesRepo(db).get(note.id)!;
    expect(plain.title.startsWith('enc:v1:')).toBe(true);
    expect(plain.body.startsWith('enc:v1:')).toBe(true);
    expect(plain.body).not.toContain('classified');
  });

  it('encrypts on update too, and round-trips', () => {
    const { db, codec, nb } = ctx;
    const repo = notesRepo(db, codec);
    const note = repo.create({ notebookId: nb.id, title: 'v0', body: 'first' });
    const updated = repo.update(note.id, 0, { title: 'v1', body: 'second draft' });
    expect(updated.title).toBe('v1');

    const raw = db.prepare('SELECT body FROM notes WHERE id = ?').get(note.id) as { body: string };
    expect(raw.body.startsWith('enc:v1:')).toBe(true);
    expect(raw.body).not.toContain('second');
    expect(repo.get(note.id)!.body).toBe('second draft');
  });

  it('listByNotebook decrypts every row', () => {
    const { db, codec, nb } = ctx;
    const repo = notesRepo(db, codec);
    repo.create({ notebookId: nb.id, title: 'Alpha', body: 'one' });
    repo.create({ notebookId: nb.id, title: 'Beta', body: 'two' });
    const titles = repo
      .listByNotebook(nb.id)
      .map((n) => n.title)
      .sort();
    expect(titles).toEqual(['Alpha', 'Beta']);
  });

  it('persists across a lock/unlock cycle (same passphrase recovers content)', async () => {
    const { db, vault, codec, nb } = ctx;
    const note = notesRepo(db, codec).create({
      notebookId: nb.id,
      title: 'Persistent',
      body: 'survives locking',
    });

    vault.lock();
    expect(vault.fieldCodec()).toBeNull();

    await vault.unlock('vault-pass');
    const codec2 = vault.fieldCodec()!;
    const read = notesRepo(db, codec2).get(note.id)!;
    expect(read.title).toBe('Persistent');
    expect(read.body).toBe('survives locking');
  });

  it('without a vault, notes stay plaintext on disk (default, unchanged)', () => {
    const db = openDb(':memory:');
    migrate(db);
    const nb = notebooksRepo(db).create({ name: 'Plain' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 'Open', body: 'visible' });
    const raw = db.prepare('SELECT title, body FROM notes WHERE id = ?').get(note.id) as {
      title: string;
      body: string;
    };
    expect(raw.title).toBe('Open');
    expect(raw.body).toBe('visible');
  });
});
