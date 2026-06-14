import type { Migration } from './index.js';

/**
 * Tamper-evident security audit log (F1284).
 *
 * An append-only, hash-chained log of security-relevant events (vault created,
 * unlocked, locked, passphrase changed, wiped). Each row commits to the one
 * before it: `hash = SHA-256(seq | event | detail | ts | prev_hash)`. Altering
 * or deleting any historical row breaks the chain from that point forward, so a
 * later `verify()` detects tampering. The log itself stores no secrets — only
 * event types and non-sensitive detail.
 *
 * `security_audit`:
 *   - seq:       monotonic sequence number (1-based)
 *   - event:     event type string (e.g. 'vault.unlocked')
 *   - detail:    JSON string of non-sensitive context (never key material)
 *   - ts:        ISO timestamp
 *   - prev_hash: hex hash of the previous row ('' for the genesis row)
 *   - hash:      hex SHA-256 over (seq | event | detail | ts | prev_hash)
 */
export const migration021SecurityAudit: Migration = {
  id: 21,
  name: 'security-audit',
  sql: /* sql */ `
    CREATE TABLE security_audit (
      seq       INTEGER NOT NULL PRIMARY KEY,
      event     TEXT    NOT NULL,
      detail    TEXT    NOT NULL DEFAULT '{}',
      ts        TEXT    NOT NULL,
      prev_hash TEXT    NOT NULL,
      hash      TEXT    NOT NULL
    );
  `,
};
