/**
 * Vault service tests (F1220). Vaults are created with the 'interactive' KDF
 * strength so the suite stays fast — the moderate-cost KDF is covered by the
 * crypto-core known-answer tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AppError } from '@fables/core';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { vaultRepo } from '../db/repos/vault.js';
import { VaultService } from './service.js';

function freshVault() {
  const db = openDb(':memory:');
  migrate(db);
  return { db, vault: new VaultService(db) };
}

describe('vault lifecycle (F1211, F1221)', () => {
  let vault: VaultService;

  beforeEach(() => {
    vault = freshVault().vault;
  });

  it('reports absent before creation, unlocked after', async () => {
    expect(vault.status()).toBe('absent');
    await vault.create('open sesame', 'interactive');
    expect(vault.status()).toBe('unlocked');
    expect(vault.isUnlocked()).toBe(true);
  });

  it('refuses to create a second vault', async () => {
    await vault.create('first', 'interactive');
    await expect(vault.create('second', 'interactive')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('locks (zeroing the key) and unlocks again', async () => {
    await vault.create('hunter2', 'interactive');
    vault.lock();
    expect(vault.status()).toBe('locked');
    expect(vault.isUnlocked()).toBe(false);
    await vault.unlock('hunter2');
    expect(vault.status()).toBe('unlocked');
  });

  it('rejects a wrong passphrase with FORBIDDEN and stays locked', async () => {
    await vault.create('correct', 'interactive');
    vault.lock();
    await expect(vault.unlock('wrong')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(vault.status()).toBe('locked');
  });

  it('cannot unlock when no vault exists', async () => {
    await expect(vault.unlock('whatever')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('field encryption at rest (F1216, F1217)', () => {
  let vault: VaultService;

  beforeEach(async () => {
    vault = freshVault().vault;
    await vault.create('vault-pass', 'interactive');
  });

  it('round-trips a field', async () => {
    const ct = await vault.encryptField('The dragon sleeps beneath the keep.');
    expect(await vault.decryptField(ct)).toBe('The dragon sleeps beneath the keep.');
  });

  it('ciphertext does not contain the plaintext', async () => {
    const ct = await vault.encryptField('SECRET-MARKER-12345');
    expect(ct).not.toContain('SECRET-MARKER-12345');
  });

  it('produces different ciphertext each time (fresh nonce)', async () => {
    const a = await vault.encryptField('same');
    const b = await vault.encryptField('same');
    expect(a).not.toBe(b);
    expect(await vault.decryptField(a)).toBe('same');
    expect(await vault.decryptField(b)).toBe('same');
  });

  it('cannot encrypt or decrypt while locked', async () => {
    const ct = await vault.encryptField('locked test');
    vault.lock();
    await expect(vault.encryptField('x')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(vault.decryptField(ct)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('passphrase change (F1223)', () => {
  it('re-wraps without re-encrypting: old content still decrypts, old pass fails', async () => {
    const { db, vault } = freshVault();
    await vault.create('old-pass', 'interactive');

    // Encrypt content under the original passphrase.
    const ct = await vault.encryptField('survives the rotation');
    const saltBefore = vaultRepo(db).get()!.salt;

    await vault.changePassphrase('old-pass', 'new-pass');

    // The salt changed (new master) but the data key did not, so old ciphertext
    // still decrypts.
    const saltAfter = vaultRepo(db).get()!.salt;
    expect(Buffer.from(saltAfter).equals(Buffer.from(saltBefore))).toBe(false);
    expect(await vault.decryptField(ct)).toBe('survives the rotation');

    // Lock, then only the new passphrase unlocks.
    vault.lock();
    await expect(vault.unlock('old-pass')).rejects.toBeInstanceOf(AppError);
    await vault.unlock('new-pass');
    expect(await vault.decryptField(ct)).toBe('survives the rotation');
  });

  it('rejects a wrong current passphrase', async () => {
    const { vault } = freshVault();
    await vault.create('real', 'interactive');
    vault.lock();
    await expect(vault.changePassphrase('fake', 'whatever')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
