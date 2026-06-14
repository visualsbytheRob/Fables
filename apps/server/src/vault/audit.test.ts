/**
 * Tamper-evident audit log + full vault wipe tests (F1281, F1284, F1290).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { vaultRepo } from '../db/repos/vault.js';
import { auditLog } from './audit.js';
import { VaultService } from './service.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

describe('security audit log: hash chain (F1284)', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it('chains entries and verifies an intact log', () => {
    const log = auditLog(db);
    const a = log.append('vault.created', { kdfStrength: 'moderate' });
    const b = log.append('vault.unlocked');
    const c = log.append('vault.locked');

    expect(a.seq).toBe(1);
    expect(a.prevHash).toBe('');
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);
    expect(log.verify()).toEqual({ ok: true });
    expect(log.count()).toBe(3);
  });

  it('detects a tampered detail field', () => {
    const log = auditLog(db);
    log.append('vault.created');
    log.append('vault.unlocked');
    log.append('vault.locked');

    // Tamper directly with the middle row's detail, bypassing append().
    db.prepare('UPDATE security_audit SET detail = \'{"forged":true}\' WHERE seq = 2').run();
    expect(log.verify()).toEqual({ ok: false, brokenAt: 2 });
  });

  it('detects a deleted row (broken sequence)', () => {
    const log = auditLog(db);
    log.append('vault.created');
    log.append('vault.unlocked');
    log.append('vault.locked');

    db.prepare('DELETE FROM security_audit WHERE seq = 2').run();
    // seq 3 now follows seq 1 directly → prev_hash mismatch at seq 3.
    expect(log.verify()).toEqual({ ok: false, brokenAt: 3 });
  });

  it('an empty log verifies trivially', () => {
    expect(auditLog(db).verify()).toEqual({ ok: true });
  });
});

describe('vault service writes audit events', () => {
  it('records created → unlocked → locked → passphrase_changed, all verifiable', async () => {
    const db = freshDb();
    const vault = new VaultService(db);
    await vault.create('pass1', 'interactive');
    vault.lock();
    await vault.unlock('pass1');
    await vault.changePassphrase('pass1', 'pass2');

    const log = auditLog(db);
    const events = log.list().map((e) => e.event);
    expect(events).toContain('vault.created');
    expect(events).toContain('vault.unlocked');
    expect(events).toContain('vault.locked');
    expect(events).toContain('vault.passphrase_changed');
    expect(log.verify()).toEqual({ ok: true });
  });

  it('records a failed unlock', async () => {
    const db = freshDb();
    const vault = new VaultService(db);
    await vault.create('right', 'interactive');
    vault.lock();
    await expect(vault.unlock('wrong')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      auditLog(db)
        .list()
        .map((e) => e.event),
    ).toContain('vault.unlock_failed');
  });
});

describe('full vault wipe with verification (F1281)', () => {
  it('removes the vault + all notes after re-auth, and verifies', async () => {
    const db = freshDb();
    const vault = new VaultService(db);
    await vault.create('secret-pass', 'interactive');
    const nb = notebooksRepo(db).create({ name: 'Vault NB' });
    const codec = vault.fieldCodec()!;
    notesRepo(db, codec).create({ notebookId: nb.id, title: 'a', body: 'one' });
    notesRepo(db, codec).create({ notebookId: nb.id, title: 'b', body: 'two' });

    const result = await vault.wipe('secret-pass');
    expect(result).toEqual({ notesDeleted: 2, verified: true });

    // Vault is gone, notes are gone, status is absent.
    expect(vaultRepo(db).exists()).toBe(false);
    expect(notesRepo(db).count()).toBe(0);
    expect(vault.status()).toBe('absent');

    // The wipe is recorded as a fresh genesis entry and still verifies.
    const log = auditLog(db);
    const entries = log.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.event).toBe('vault.wiped');
    expect(log.verify()).toEqual({ ok: true });
  });

  it('rejects a wipe with the wrong passphrase (nothing destroyed)', async () => {
    const db = freshDb();
    const vault = new VaultService(db);
    await vault.create('real-pass', 'interactive');
    const nb = notebooksRepo(db).create({ name: 'NB' });
    notesRepo(db, vault.fieldCodec()!).create({ notebookId: nb.id, title: 't', body: 'keep me' });

    await expect(vault.wipe('not-the-pass')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(vaultRepo(db).exists()).toBe(true);
    expect(notesRepo(db).count()).toBe(1);
  });
});
