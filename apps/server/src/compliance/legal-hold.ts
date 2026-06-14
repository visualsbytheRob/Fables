/**
 * Legal hold mode (F1286).
 *
 * When legal hold is active, destructive operations (trash purge, note
 * hard-delete) must be blocked. The flag is persisted in the
 * `compliance_settings` table so it survives server restarts.
 */

import { nowIso } from '@fables/core';
import type { Db } from '../db/connection.js';

export interface LegalHoldStatus {
  active: boolean;
  updatedAt: string | null;
}

export function legalHoldRepo(db: Db) {
  return {
    get(): LegalHoldStatus {
      const row = db
        .prepare(`SELECT value, updated_at FROM compliance_settings WHERE key = 'legal_hold'`)
        .get() as { value: string; updated_at: string } | undefined;
      return {
        active: row?.value === 'true',
        updatedAt: row?.updated_at ?? null,
      };
    },

    set(active: boolean): LegalHoldStatus {
      const now = nowIso();
      db.prepare(
        `INSERT INTO compliance_settings (key, value, updated_at) VALUES ('legal_hold', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(active ? 'true' : 'false', now);
      return { active, updatedAt: now };
    },

    /** Throws an error payload (not an AppError — intentional plain Error) if hold is active. */
    assertNotHeld(): void {
      const { active } = this.get();
      if (active) {
        throw Object.assign(
          new Error('legal hold is active — destructive operations are blocked'),
          {
            legalHold: true,
          },
        );
      }
    },
  };
}

export type LegalHoldRepo = ReturnType<typeof legalHoldRepo>;
