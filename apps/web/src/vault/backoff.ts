/**
 * Exponential backoff state for wrong-passphrase attempts (F1226).
 *
 * After each failed attempt the lock duration doubles:
 *   attempt 1 → 0 s  (no lock on first fail)
 *   attempt 2 → 5 s
 *   attempt 3 → 10 s
 *   attempt 4 → 20 s
 *   attempt 5+ → 40 s (capped)
 *
 * The state lives in a plain object so it can be held in React state or a
 * ref. Tests drive it with fake timers.
 */

export interface BackoffState {
  failCount: number;
  /** Epoch ms when the lockout expires (0 = not locked). */
  lockedUntil: number;
}

export const INITIAL_BACKOFF: BackoffState = { failCount: 0, lockedUntil: 0 };

/** Returns the lockout duration (ms) for the given fail count (1-based). */
export function lockDurationMs(failCount: number): number {
  if (failCount <= 1) return 0;
  // Base 5 s, doubling from the 2nd failure, capped at 40 s
  return Math.min(5_000 * 2 ** (failCount - 2), 40_000);
}

/** Returns the next BackoffState after a failed attempt. */
export function recordFailure(state: BackoffState): BackoffState {
  const next = state.failCount + 1;
  const dur = lockDurationMs(next);
  return {
    failCount: next,
    lockedUntil: dur > 0 ? Date.now() + dur : 0,
  };
}

/** Returns the next BackoffState after a successful attempt (reset). */
export function recordSuccess(_state: BackoffState): BackoffState {
  return INITIAL_BACKOFF;
}

/** True if the user is currently locked out. */
export function isLockedOut(state: BackoffState): boolean {
  return state.lockedUntil > 0 && Date.now() < state.lockedUntil;
}

/** Remaining lockout time in seconds (0 if not locked). */
export function secondsRemaining(state: BackoffState): number {
  if (!isLockedOut(state)) return 0;
  return Math.ceil((state.lockedUntil - Date.now()) / 1000);
}
