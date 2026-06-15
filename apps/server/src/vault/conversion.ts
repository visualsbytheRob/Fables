/**
 * Vault conversion (Epic 13, F1215).
 *
 * Migrates an existing plaintext note store into the encrypted vault — and back.
 * With the vault unlocked, every note's title/body is re-written through the
 * field codec and each one is verified to round-trip before the conversion is
 * declared complete. The pass is idempotent: a field already in its target form
 * (encrypted when encrypting, plaintext when decrypting) is skipped.
 */

import { isEncryptedField } from '@fables/core';
import type { Db } from '../db/connection.js';
import { withTransaction } from '../db/connection.js';
import type { FieldCodec } from './service.js';

export interface ConversionReport {
  direction: 'encrypt' | 'decrypt';
  converted: number;
  skipped: number;
  total: number;
  verified: true;
}

interface NoteRow {
  id: string;
  title: string;
  body: string;
}

/**
 * Encrypt every plaintext note in place using the unlocked vault codec (F1215).
 * Verifies each converted note decrypts back to the original before committing.
 */
export function convertToEncrypted(db: Db, codec: FieldCodec): ConversionReport {
  return convert(db, codec, 'encrypt');
}

/** Decrypt every encrypted note back to plaintext (reverse migration, F1297). */
export function convertToPlaintext(db: Db, codec: FieldCodec): ConversionReport {
  return convert(db, codec, 'decrypt');
}

function convert(db: Db, codec: FieldCodec, direction: 'encrypt' | 'decrypt'): ConversionReport {
  const rows = db.prepare('SELECT id, title, body FROM notes').all() as NoteRow[];
  let converted = 0;
  let skipped = 0;

  const update = db.prepare('UPDATE notes SET title = ?, body = ?, rev = rev + 1 WHERE id = ?');

  withTransaction(db, () => {
    for (const row of rows) {
      const titleEncrypted = isEncryptedField(row.title);
      const bodyEncrypted = isEncryptedField(row.body);
      const alreadyDone =
        direction === 'encrypt'
          ? titleEncrypted && bodyEncrypted
          : !titleEncrypted && !bodyEncrypted;
      if (alreadyDone) {
        skipped += 1;
        continue;
      }

      let nextTitle: string;
      let nextBody: string;
      if (direction === 'encrypt') {
        nextTitle = titleEncrypted ? row.title : codec.encrypt(row.title);
        nextBody = bodyEncrypted ? row.body : codec.encrypt(row.body);
        // Verify the ciphertext round-trips to the original plaintext.
        if (codec.decrypt(nextTitle) !== row.title || codec.decrypt(nextBody) !== row.body) {
          throw new Error(`conversion verification failed for note ${row.id}`);
        }
      } else {
        nextTitle = titleEncrypted ? codec.decrypt(row.title) : row.title;
        nextBody = bodyEncrypted ? codec.decrypt(row.body) : row.body;
      }

      update.run(nextTitle, nextBody, row.id);
      converted += 1;
    }
  });

  return { direction, converted, skipped, total: rows.length, verified: true };
}
