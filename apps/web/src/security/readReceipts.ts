/**
 * F1285 — Read-receipts opt-out.
 *
 * A simple localStorage-backed preference.  When disabled, any code that
 * would report presence, last-seen, or read-receipt signals should check
 * `readReceiptsEnabled()` before firing.
 *
 * Key convention mirrors the existing analytics/notification keys:
 *   `fables.readReceipts.enabled`  (string "true" | "false")
 */

const READ_RECEIPTS_KEY = 'fables.readReceipts.enabled';

/**
 * Returns `true` when read-receipt / last-seen reporting is allowed.
 * Defaults to `true` (opt-in behaviour — existing sessions keep working).
 */
export function readReceiptsEnabled(): boolean {
  try {
    const stored = localStorage.getItem(READ_RECEIPTS_KEY);
    if (stored === null) return true; // default on
    return stored !== 'false';
  } catch {
    return true;
  }
}

/**
 * Persist the read-receipts preference.
 */
export function setReadReceiptsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(READ_RECEIPTS_KEY, String(enabled));
  } catch {
    // ignore – storage quota or private mode
  }
}
