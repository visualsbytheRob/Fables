/**
 * Vault service (F1211–F1220) — the at-rest encryption tier.
 *
 * Threat model: the Fables server runs on the user's own machine. The goal is
 * that the database file at rest reveals no note content — if the disk or the
 * `.fables` directory is copied, the thief gets ciphertext and a salt, nothing
 * more. While the vault is unlocked, the data key (DEK) lives in process memory
 * so the running server can read/write content; on lock (or process exit) the
 * DEK is zeroed (F1234, F1205).
 *
 * Key flow:
 *   create()  → generate salt + DEK, wrap DEK under master(passphrase, salt), persist
 *   unlock()  → derive master(passphrase, salt), unwrap DEK into memory
 *   lock()    → zero the in-memory DEK
 *   encrypt() / decrypt() → field-level seal/open under the DEK (requires unlock)
 *   changePassphrase() → re-derive master from a NEW salt, re-wrap the SAME DEK
 *                         (content is never re-encrypted) (F1223)
 *
 * A wrong passphrase is detected for free: the wrapped DEK is an AEAD box, so an
 * incorrect master key fails authentication on unwrap. No separate verifier and
 * no oracle beyond "auth failed".
 */

import {
  AppError,
  CURRENT_CRYPTO_PARAMS,
  bytesToUtf8,
  decryptFieldSync,
  deriveMasterKey,
  encryptFieldSync,
  fromBase64,
  generateDataKey,
  generateSalt,
  open,
  packSealed,
  seal,
  toBase64,
  unpackSealed,
  unwrapDataKey,
  utf8ToBytes,
  wrapDataKey,
  zeroKey,
  type CryptoParams,
  type DataKey,
  type KdfStrength,
} from '@fables/core';
import type { Db } from '../db/connection.js';
import { withTransaction } from '../db/connection.js';
import { vaultRepo } from '../db/repos/vault.js';
import { auditLog } from './audit.js';

export type VaultStatus = 'absent' | 'locked' | 'unlocked';

function paramsFor(version: number, strength: KdfStrength): CryptoParams {
  return { ...CURRENT_CRYPTO_PARAMS, version, kdfStrength: strength };
}

export class VaultService {
  /** In-memory data key; null when the vault is locked or absent. */
  private dek: DataKey | null = null;

  constructor(private readonly db: Db) {}

  status(): VaultStatus {
    if (!vaultRepo(this.db).exists()) return 'absent';
    return this.dek ? 'unlocked' : 'locked';
  }

  isUnlocked(): boolean {
    return this.dek !== null;
  }

  /**
   * Create a new vault from a passphrase (F1211, F1215). Leaves the vault
   * unlocked. Throws CONFLICT if a vault already exists.
   */
  async create(passphrase: string, strength: KdfStrength = 'moderate'): Promise<void> {
    if (vaultRepo(this.db).exists()) throw new AppError('CONFLICT', 'vault already exists');
    if (passphrase.length < 1) throw new AppError('VALIDATION', 'passphrase required');

    const params = paramsFor(CURRENT_CRYPTO_PARAMS.version, strength);
    const salt = await generateSalt();
    const master = await deriveMasterKey(passphrase, salt, params);
    const dek = await generateDataKey();
    const wrapped = await wrapDataKey(dek, master);
    zeroKey(master);

    vaultRepo(this.db).create({
      salt,
      wrappedDek: packSealed(wrapped),
      paramsVersion: params.version,
      kdfStrength: strength,
    });
    this.dek = dek;
    auditLog(this.db).append('vault.created', { kdfStrength: strength });
  }

  /** Unlock with a passphrase (F1221). Throws FORBIDDEN on a wrong passphrase. */
  async unlock(passphrase: string): Promise<void> {
    const cfg = vaultRepo(this.db).get();
    if (!cfg) throw new AppError('NOT_FOUND', 'no vault to unlock');

    const params = paramsFor(cfg.paramsVersion, cfg.kdfStrength);
    const master = await deriveMasterKey(passphrase, cfg.salt, params);
    try {
      this.dek = await unwrapDataKey(unpackSealed(cfg.wrappedDek), master);
    } catch {
      auditLog(this.db).append('vault.unlock_failed');
      throw new AppError('FORBIDDEN', 'incorrect passphrase');
    } finally {
      zeroKey(master);
    }
    auditLog(this.db).append('vault.unlocked');
  }

  /** Lock the vault: zero the in-memory data key (F1234). Idempotent. */
  lock(): void {
    if (this.dek) {
      zeroKey(this.dek);
      this.dek = null;
      auditLog(this.db).append('vault.locked');
    }
  }

  /** Encrypt a plaintext field for storage at rest (F1217). Returns base64. */
  async encryptField(plaintext: string): Promise<string> {
    const dek = this.requireUnlocked();
    const sealed = await seal(await utf8ToBytes(plaintext), dek);
    return toBase64(packSealed(sealed));
  }

  /** Decrypt a base64 field read from storage (F1216). */
  async decryptField(ciphertextB64: string): Promise<string> {
    const dek = this.requireUnlocked();
    const sealed = unpackSealed(await fromBase64(ciphertextB64));
    return bytesToUtf8(await open(sealed, dek));
  }

  /**
   * Change the passphrase (F1223). Verifies the current passphrase, then derives
   * a fresh master key from a new salt and re-wraps the SAME data key. Existing
   * ciphertext stays valid because the data key never changes.
   */
  async changePassphrase(current: string, next: string): Promise<void> {
    await this.unlock(current); // throws FORBIDDEN if current is wrong; sets this.dek
    const dek = this.requireUnlocked();
    if (next.length < 1) throw new AppError('VALIDATION', 'new passphrase required');

    const params = paramsFor(CURRENT_CRYPTO_PARAMS.version, CURRENT_CRYPTO_PARAMS.kdfStrength);
    const newSalt = await generateSalt();
    const newMaster = await deriveMasterKey(next, newSalt, params);
    const rewrapped = await wrapDataKey(dek, newMaster);
    zeroKey(newMaster);

    vaultRepo(this.db).rewrap({
      salt: newSalt,
      wrappedDek: packSealed(rewrapped),
      paramsVersion: params.version,
      kdfStrength: params.kdfStrength,
    });
    auditLog(this.db).append('vault.passphrase_changed');
  }

  /**
   * Full vault wipe with verification (F1281). Re-authenticates with the
   * passphrase, then irreversibly deletes the vault config and ALL note content
   * (revisions/tags/links cascade), zeroes the in-memory key, resets the audit
   * log to a single genesis 'vault.wiped' entry, and verifies the wipe took.
   * Returns the count of notes removed; throws if verification fails.
   */
  async wipe(passphrase: string): Promise<{ notesDeleted: number; verified: true }> {
    await this.unlock(passphrase); // FORBIDDEN if wrong — re-auth before destruction

    const notesDeleted = withTransaction(this.db, () => {
      const n = (this.db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n;
      this.db.prepare('DELETE FROM notes').run();
      vaultRepo(this.db).destroy();
      return n;
    });

    this.lock();
    const audit = auditLog(this.db);
    audit.clear();
    audit.append('vault.wiped', { notesDeleted });

    // Verify (F1281): the vault is gone and no notes remain.
    const remaining = (this.db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n;
    if (vaultRepo(this.db).exists() || remaining !== 0) {
      throw new AppError('INTERNAL', 'vault wipe verification failed');
    }
    return { notesDeleted, verified: true };
  }

  /**
   * A synchronous field codec bound to the unlocked data key, or null when the
   * vault is locked (F1211). The notes repo uses this to encrypt note titles and
   * bodies on write and decrypt them on read, inline with synchronous SQLite.
   * Fetch a fresh codec per request — a captured one becomes unusable once the
   * vault locks (the underlying key is zeroed).
   */
  fieldCodec(): FieldCodec | null {
    if (!this.dek) return null;
    const dek = this.dek;
    return {
      encrypt: (plaintext: string) => encryptFieldSync(plaintext, dek),
      decrypt: (stored: string) => decryptFieldSync(stored, dek),
    };
  }

  private requireUnlocked(): DataKey {
    if (!this.dek) throw new AppError('FORBIDDEN', 'vault is locked');
    return this.dek;
  }
}

/** Synchronous encrypt/decrypt pair for at-rest field encryption (F1211). */
export interface FieldCodec {
  encrypt(plaintext: string): string;
  decrypt(stored: string): string;
}
