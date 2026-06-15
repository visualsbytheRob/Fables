/**
 * Secret notes (Epic 13, F1241–F1250).
 *
 * Per-note encryption with a key path entirely separate from the vault (F1242):
 * a secret passphrase derives a secret master key that unwraps a secret data key
 * (DEK). A note marked secret has its title/body sealed under that DEK and stored
 * as `enc:v1:` ciphertext, so it is unreadable — and excluded from search,
 * exports, AI and plugins (F1244/F1249) — until the secret box is unlocked. The
 * secret session has its own idle timeout, independent of the vault (F1248).
 */

import {
  CURRENT_CRYPTO_PARAMS,
  decryptFieldSync,
  deriveMasterKey,
  encryptFieldSync,
  generateDataKey,
  generateSalt,
  isEncryptedField,
  packSealed,
  unpackSealed,
  unwrapDataKey,
  wrapDataKey,
  zeroKey,
  AppError,
  type CryptoParams,
  type DataKey,
  type KdfStrength,
  type NoteId,
} from '@fables/core';
import type { Db } from '../db/connection.js';
import { secretBoxRepo } from '../db/repos/secret-box.js';
import { auditLog } from './audit.js';
import { EncryptedSearchIndex, type SearchHit } from '../search/encrypted-index.js';

export type SecretStatus = 'absent' | 'locked' | 'unlocked';

/** Default idle timeout for the secret session — independent of the vault (F1248). */
export const DEFAULT_SECRET_TIMEOUT_MS = 5 * 60 * 1000;

function paramsFor(version: number, strength: KdfStrength): CryptoParams {
  return { ...CURRENT_CRYPTO_PARAMS, version, kdfStrength: strength };
}

interface NoteFields {
  id: string;
  title: string;
  body: string;
  rev: number;
}

export class SecretNotesService {
  private dek: DataKey | null = null;
  private lastActivity = 0;
  /** In-memory FTS over decrypted secret notes; lives only while unlocked (F1213). */
  private readonly index = new EncryptedSearchIndex();

  constructor(
    private readonly db: Db,
    private readonly timeoutMs: number = DEFAULT_SECRET_TIMEOUT_MS,
    private readonly now: () => number = Date.now,
  ) {}

  status(): SecretStatus {
    if (!secretBoxRepo(this.db).exists()) return 'absent';
    return this.isUnlocked() ? 'unlocked' : 'locked';
  }

  /** Unlocked AND within the idle window (F1248). Auto-locks on expiry. */
  isUnlocked(): boolean {
    if (!this.dek) return false;
    if (this.now() - this.lastActivity > this.timeoutMs) {
      this.lock();
      return false;
    }
    return true;
  }

  /** Create the secret box from a passphrase (F1242). Leaves it unlocked. */
  async create(passphrase: string, strength: KdfStrength = 'moderate'): Promise<void> {
    if (secretBoxRepo(this.db).exists())
      throw new AppError('CONFLICT', 'secret box already exists');
    if (passphrase.length < 1) throw new AppError('VALIDATION', 'passphrase required');

    const params = paramsFor(CURRENT_CRYPTO_PARAMS.version, strength);
    const salt = await generateSalt();
    const master = await deriveMasterKey(passphrase, salt, params);
    const dek = await generateDataKey();
    const wrapped = await wrapDataKey(dek, master);
    zeroKey(master);

    secretBoxRepo(this.db).create({
      salt,
      wrappedDek: packSealed(wrapped),
      paramsVersion: params.version,
      kdfStrength: strength,
    });
    this.dek = dek;
    this.touch();
    auditLog(this.db).append('secret.created', { kdfStrength: strength });
  }

  /** Unlock with the secret passphrase. Throws FORBIDDEN on a wrong passphrase. */
  async unlock(passphrase: string): Promise<void> {
    const cfg = secretBoxRepo(this.db).get();
    if (!cfg) throw new AppError('NOT_FOUND', 'no secret box to unlock');

    const params = paramsFor(cfg.paramsVersion, cfg.kdfStrength);
    const master = await deriveMasterKey(passphrase, cfg.salt, params);
    try {
      this.dek = await unwrapDataKey(unpackSealed(cfg.wrappedDek), master);
    } catch {
      auditLog(this.db).append('secret.unlock_failed');
      throw new AppError('FORBIDDEN', 'incorrect passphrase');
    } finally {
      zeroKey(master);
    }
    this.touch();
    this.rebuildIndex();
    auditLog(this.db).append('secret.unlocked');
  }

  /** Lock: zero the in-memory secret data key and drop the index (F1213). Idempotent. */
  lock(): void {
    if (this.dek) {
      zeroKey(this.dek);
      this.dek = null;
      this.index.clear();
      auditLog(this.db).append('secret.locked');
    }
  }

  /**
   * Search secret notes via the in-memory index (F1213). Empty when locked —
   * the index only exists while the secret box is unlocked.
   */
  search(query: string, limit = 20): SearchHit[] {
    if (!this.isUnlocked()) return [];
    this.touch();
    return this.index.search(query, { limit });
  }

  /** Decrypt every secret note into the in-memory FTS index (post-unlock). */
  private rebuildIndex(): void {
    if (!this.dek) return;
    this.index.clear();
    const rows = this.db
      .prepare('SELECT id, title, body FROM notes WHERE secret = 1 AND trashed_at IS NULL')
      .all() as { id: string; title: string; body: string }[];
    for (const row of rows) {
      const title = isEncryptedField(row.title) ? decryptFieldSync(row.title, this.dek) : row.title;
      const body = isEncryptedField(row.body) ? decryptFieldSync(row.body, this.dek) : row.body;
      this.index.add({ id: row.id, title, body });
    }
  }

  /** Refresh the idle timer (called on each authorized access). */
  touch(): void {
    this.lastActivity = this.now();
  }

  private requireUnlocked(): DataKey {
    if (!this.isUnlocked()) throw new AppError('FORBIDDEN', 'secret box is locked');
    this.touch();
    return this.dek!;
  }

  /** Mark a note secret: encrypt its current fields under the secret DEK (F1241). */
  markSecret(noteId: string): boolean {
    const dek = this.requireUnlocked();
    const note = this.readNote(noteId);
    if (!note) return false;
    if (this.isNoteSecret(noteId)) return true; // already secret
    const title = encryptFieldSync(note.title, dek);
    const body = encryptFieldSync(note.body, dek);
    this.writeNote(noteId, title, body, note.rev, 1);
    // Keep the in-memory index current with the plaintext we still hold (F1213).
    this.index.add({ id: noteId, title: note.title, body: note.body });
    auditLog(this.db).append('secret.note_marked', { noteId });
    return true;
  }

  /** Reveal a note: decrypt its fields and clear the secret flag (F1245). */
  unmarkSecret(noteId: string): boolean {
    const dek = this.requireUnlocked();
    const note = this.readNote(noteId);
    if (!note) return false;
    if (!this.isNoteSecret(noteId)) return true;
    const title = isEncryptedField(note.title) ? decryptFieldSync(note.title, dek) : note.title;
    const body = isEncryptedField(note.body) ? decryptFieldSync(note.body, dek) : note.body;
    this.writeNote(noteId, title, body, note.rev, 0);
    this.index.remove(noteId);
    auditLog(this.db).append('secret.note_revealed', { noteId });
    return true;
  }

  /** Bulk convert notes to/from secret (F1245). Returns how many changed. */
  bulkConvert(noteIds: string[], toSecret: boolean): number {
    let changed = 0;
    for (const id of noteIds) {
      const ok = toSecret ? this.markSecret(id) : this.unmarkSecret(id);
      if (ok) changed += 1;
    }
    return changed;
  }

  /** Decrypt a secret note's fields for display (requires unlock). */
  reveal(noteId: string): { title: string; body: string } | null {
    const dek = this.requireUnlocked();
    const note = this.readNote(noteId);
    if (!note) return null;
    return {
      title: isEncryptedField(note.title) ? decryptFieldSync(note.title, dek) : note.title,
      body: isEncryptedField(note.body) ? decryptFieldSync(note.body, dek) : note.body,
    };
  }

  isNoteSecret(noteId: string): boolean {
    const row = this.db.prepare('SELECT secret FROM notes WHERE id = ?').get(noteId) as
      | { secret: number }
      | undefined;
    return row?.secret === 1;
  }

  /** The ids of every secret note (used to exclude them from search/export). */
  secretNoteIds(): Set<string> {
    const rows = this.db.prepare('SELECT id FROM notes WHERE secret = 1').all() as { id: string }[];
    return new Set(rows.map((r) => r.id));
  }

  private readNote(noteId: string): NoteFields | null {
    const row = this.db
      .prepare('SELECT id, title, body, rev FROM notes WHERE id = ? AND trashed_at IS NULL')
      .get(noteId) as NoteFields | undefined;
    return row ?? null;
  }

  private writeNote(
    noteId: string,
    title: string,
    body: string,
    expectedRev: number,
    secret: 0 | 1,
  ): void {
    this.db
      .prepare(
        'UPDATE notes SET title = ?, body = ?, secret = ?, rev = rev + 1 WHERE id = ? AND rev = ?',
      )
      .run(title, body, secret, noteId, expectedRev);
  }
}

/**
 * A note is hidden from a surface when it is secret and the secret box is locked
 * (F1244 search/exports, F1249 plugins). Secret content is `enc:` ciphertext at
 * rest, so this also catches any encrypted field defensively.
 */
export function isSecretHidden(
  note: { secret?: boolean | number | undefined; title: string; body: string },
  secretUnlocked: boolean,
): boolean {
  const flagged = note.secret === true || note.secret === 1;
  if (flagged && !secretUnlocked) return true;
  return isEncryptedField(note.title) || isEncryptedField(note.body);
}

export type { NoteId };
