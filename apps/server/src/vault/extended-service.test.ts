/**
 * ExtendedVaultService binary blob seal/open tests (F1214 primitive).
 *
 * Validates the at-rest binary encryption that encrypted attachments build on:
 * round-trip, no plaintext leak, lossless bytes, lock enforcement, and tamper
 * rejection. (Wiring this into the live attachment save/read path is a follow-on.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { ExtendedVaultService } from './extended-service.js';

function freshVault() {
  const db = openDb(':memory:');
  migrate(db);
  return new ExtendedVaultService(db);
}

describe('ExtendedVaultService blob crypto (F1214)', () => {
  let vault: ExtendedVaultService;
  beforeEach(async () => {
    vault = freshVault();
    await vault.create('blob-pass', 'interactive');
  });

  it('round-trips a binary blob', () => {
    const plain = new TextEncoder().encode('attachment bytes: the secret map');
    const sealed = vault.sealBlob(plain);
    expect(new TextDecoder().decode(vault.openBlob(sealed))).toBe(
      'attachment bytes: the secret map',
    );
  });

  it('ciphertext contains no plaintext', () => {
    const plain = new TextEncoder().encode('SECRET-MAP-COORDINATES');
    const sealed = vault.sealBlob(plain);
    expect(Buffer.from(sealed).toString('latin1')).not.toContain('SECRET-MAP');
  });

  it('is lossless for arbitrary bytes', () => {
    const plain = new Uint8Array(1024);
    for (let i = 0; i < plain.length; i++) plain[i] = (i * 37) & 0xff;
    const out = vault.openBlob(vault.sealBlob(plain));
    expect([...out]).toEqual([...plain]);
  });

  it('produces distinct ciphertext per call (fresh nonce)', () => {
    const plain = new TextEncoder().encode('same');
    const a = Buffer.from(vault.sealBlob(plain)).toString('hex');
    const b = Buffer.from(vault.sealBlob(plain)).toString('hex');
    expect(a).not.toBe(b);
  });

  it('refuses to seal or open while locked', () => {
    const sealed = vault.sealBlob(new Uint8Array([1, 2, 3]));
    vault.lock();
    expect(() => vault.sealBlob(new Uint8Array([1]))).toThrow();
    expect(() => vault.openBlob(sealed)).toThrow();
  });

  it('rejects a tampered blob', () => {
    const sealed = vault.sealBlob(new TextEncoder().encode('integrity'));
    sealed[sealed.length - 1] = (sealed[sealed.length - 1]! ^ 0x01) & 0xff;
    expect(() => vault.openBlob(sealed)).toThrow();
  });

  it('recovers a blob across a lock/unlock cycle', async () => {
    const sealed = vault.sealBlob(new TextEncoder().encode('persisted'));
    vault.lock();
    await vault.unlock('blob-pass');
    expect(new TextDecoder().decode(vault.openBlob(sealed))).toBe('persisted');
  });
});
