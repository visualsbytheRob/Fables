/**
 * Exponential backoff + jitter policy (F861).
 * Pure function — no timers, fully testable.
 */

export interface BackoffConfig {
  /** Base delay in milliseconds. */
  baseMs: number;
  /** Maximum delay cap in milliseconds. */
  maxMs: number;
  /** Jitter fraction [0, 1] — e.g. 0.3 means ±30% of computed delay. */
  jitter: number;
  /** Maximum consecutive failures before giving up. 0 = never give up. */
  maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseMs: 1_000,
  maxMs: 60_000,
  jitter: 0.3,
  maxAttempts: 0, // never give up by default
};

export interface BackoffResult {
  delayMs: number;
  shouldGiveUp: boolean;
}

/**
 * Compute the next backoff delay for the given attempt number (1-based).
 * Returns delayMs with full jitter applied.
 *
 * Formula: min(base * 2^(attempt-1), max) * (1 ± jitter)
 *
 * @param attempt   1-based attempt number
 * @param config    backoff configuration
 * @param random    injectable random source for deterministic tests
 */
export function computeBackoff(
  attempt: number,
  config: BackoffConfig = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): BackoffResult {
  if (config.maxAttempts > 0 && attempt > config.maxAttempts) {
    return { delayMs: 0, shouldGiveUp: true };
  }

  const exponential = config.baseMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, config.maxMs);

  // Full jitter: uniform in [capped*(1-jitter), capped*(1+jitter)]
  const lo = capped * (1 - config.jitter);
  const hi = capped * (1 + config.jitter);
  const delayMs = Math.round(lo + random() * (hi - lo));

  return { delayMs, shouldGiveUp: false };
}

// ── Partial batch failure: per-op ack accumulation (F862) ─────────────────────

export interface BatchAck {
  accepted: string[];
  rejected: Array<{ opId: string; reason: string }>;
  /** Op IDs to quarantine (repeated rejections or schema errors). */
  quarantine: string[];
}

/** Number of rejections before an op is quarantined (F864). */
const QUARANTINE_THRESHOLD = 3;

/**
 * Track rejection counts and decide which ops to quarantine.
 * Call this after each push attempt.
 */
export class RejectionTracker {
  private counts = new Map<string, number>();

  record(ack: {
    opId: string;
    status: 'accepted' | 'rejected' | 'duplicate';
    reason?: string;
  }): void {
    if (ack.status === 'rejected') {
      const current = this.counts.get(ack.opId) ?? 0;
      this.counts.set(ack.opId, current + 1);
    } else {
      this.counts.delete(ack.opId);
    }
  }

  shouldQuarantine(opId: string): boolean {
    return (this.counts.get(opId) ?? 0) >= QUARANTINE_THRESHOLD;
  }

  getCount(opId: string): number {
    return this.counts.get(opId) ?? 0;
  }
}
