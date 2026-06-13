/**
 * Lamport clock utilities.
 * Pure functions — no side effects, fully testable (F831).
 */

export type Clock = number;

/** Advance clock: max(local, remote) + 1. Use when receiving a remote op. */
export function advanceClock(local: Clock, remote: Clock): Clock {
  return Math.max(local, remote) + 1;
}

/** Tick clock: local + 1. Use when generating a local op. */
export function tickClock(local: Clock): Clock {
  return local + 1;
}

/**
 * Compare two (lamport, deviceId) pairs for total ordering.
 * Returns negative / zero / positive, suitable for Array.sort().
 *
 * Total order: lamport ascending, then deviceId lexicographic.
 * This ensures that every pair of concurrent ops from different devices
 * has a deterministic, consistent order across all replicas.
 */
export function compareLamport(
  a: { lamport: Clock; deviceId: string },
  b: { lamport: Clock; deviceId: string },
): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
}
