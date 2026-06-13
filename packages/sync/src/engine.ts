/**
 * Client sync engine (F834, F837, F861–F868).
 *
 * Orchestrates:
 *   - Maintaining an outbox of local ops
 *   - Pushing ops to the server
 *   - Pulling remote ops and applying them to the local store
 *   - Resumable cursors via injected CursorStorage
 *   - Exponential backoff on failures
 *   - Corrupt op quarantine
 *   - Batch-size tuning
 *   - Schema version negotiation
 */

import { applyOps } from './apply.js';
import { computeBackoff, RejectionTracker, type BackoffConfig } from './backoff.js';
import { tickClock } from './clock.js';
import type { CursorStorage, LocalStore, Outbox } from './store.js';
import type {
  DeviceId,
  OpAck,
  SyncCursor,
  SyncHealth,
  SyncOp,
  SchemaNegotiation,
} from './types.js';
import { decodeCursor, encodeCursor, INITIAL_CURSOR, SYNC_SCHEMA_VERSION } from './types.js';

// ── Transport interface (injected so engine is pure of HTTP details) ───────────

export interface SyncTransport {
  pull(since: string, limit: number): Promise<PullResponse>;
  push(ops: SyncOp[], schemaVersion: number): Promise<PushResponse>;
}

export interface PullResponse {
  ops: SyncOp[];
  nextCursor: string | null;
  serverSchemaVersion: number;
}

export interface PushResponse {
  acks: OpAck[];
  serverSchemaVersion: number;
}

// ── Engine configuration ───────────────────────────────────────────────────────

export interface SyncEngineConfig {
  deviceId: DeviceId;
  /** Default push batch size (F866). */
  batchSize: number;
  backoff: BackoffConfig;
}

export const DEFAULT_ENGINE_CONFIG: SyncEngineConfig = {
  deviceId: 'unknown' as DeviceId,
  batchSize: 100,
  backoff: {
    baseMs: 1_000,
    maxMs: 60_000,
    jitter: 0.3,
    maxAttempts: 0,
  },
};

// ── Engine ────────────────────────────────────────────────────────────────────

export class SyncEngine {
  private lamport = 0;
  private health: SyncHealth = {
    lastSyncAt: null,
    pendingOps: 0,
    appliedOps: 0,
    quarantinedOps: 0,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
  };

  private rejectionTracker = new RejectionTracker();

  constructor(
    private readonly config: SyncEngineConfig,
    private readonly store: LocalStore,
    private readonly outbox: Outbox,
    private readonly cursorStorage: CursorStorage,
    private readonly transport: SyncTransport,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Enqueue a local mutation op.
   * Increments the Lamport clock and stamps the op.
   */
  enqueue(
    op: Omit<SyncOp, 'id' | 'deviceId' | 'lamport' | 'schemaVersion' | 'clientCreatedAt'>,
  ): SyncOp {
    this.lamport = tickClock(this.lamport);
    const stamped: SyncOp = {
      ...op,
      id: `${this.config.deviceId}_${this.lamport}`,
      deviceId: this.config.deviceId,
      lamport: this.lamport,
      schemaVersion: SYNC_SCHEMA_VERSION,
      clientCreatedAt: new Date().toISOString(),
    } as SyncOp;
    this.outbox.enqueue(stamped);
    this.health.pendingOps = this.outbox.pending().length;
    return stamped;
  }

  /** Current sync cursor (for display). */
  get cursor(): SyncCursor {
    return decodeCursor(String(this.cursorStorage.load()));
  }

  /** Current sync health snapshot. */
  get syncHealth(): SyncHealth {
    return {
      ...this.health,
      pendingOps: this.outbox.pending().length,
      quarantinedOps: this.outbox.quarantined().length,
    };
  }

  /** Schema version negotiation (F865). */
  negotiateSchema(serverVersion: number): SchemaNegotiation {
    const minSupportedVersion = 1;
    return {
      serverSchemaVersion: serverVersion,
      clientSchemaVersion: SYNC_SCHEMA_VERSION,
      compatible: serverVersion >= minSupportedVersion && serverVersion <= SYNC_SCHEMA_VERSION + 1,
      minSupportedVersion,
    };
  }

  /**
   * Run a full sync cycle: push outbox, then pull remote ops.
   * Resumable: on failure the cursor is not advanced.
   */
  async sync(_attempt = 1): Promise<{ pushed: number; pulled: number; errors: string[] }> {
    const errors: string[] = [];

    // 1. Push outbox
    const pending = this.outbox.pending();
    let pushed = 0;
    if (pending.length > 0) {
      const batches = chunk(pending, this.config.batchSize);
      for (const batch of batches) {
        try {
          const resp = await this.transport.push(batch, SYNC_SCHEMA_VERSION);

          // Handle schema version negotiation (F865)
          const neg = this.negotiateSchema(resp.serverSchemaVersion);
          if (!neg.compatible) {
            errors.push(
              `schema version mismatch: client=${SYNC_SCHEMA_VERSION} server=${resp.serverSchemaVersion}`,
            );
            break;
          }

          // Process acks (F862)
          const accepted: string[] = [];
          for (const ack of resp.acks) {
            this.rejectionTracker.record(ack);
            if (ack.status === 'accepted' || ack.status === 'duplicate') {
              accepted.push(ack.opId);
              pushed++;
            } else if (ack.status === 'rejected') {
              if (this.rejectionTracker.shouldQuarantine(ack.opId)) {
                this.outbox.quarantine(ack.opId, ack.reason ?? 'repeated rejection');
                errors.push(`op ${ack.opId} quarantined: ${ack.reason ?? 'repeated rejection'}`);
              } else {
                errors.push(`op ${ack.opId} rejected: ${ack.reason ?? 'unknown reason'}`);
              }
            }
          }
          this.outbox.acknowledge(accepted);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`push failed: ${msg}`);
          this.recordFailure(msg);
          // Backoff partial-batch failure (F862): stop processing further batches
          break;
        }
      }
    }

    // 2. Pull remote ops
    let pulled = 0;
    const cursor = this.cursorStorage.load();
    try {
      let curCursor = encodeCursor({ serverSeq: cursor });
      // Pull pages until exhausted
      while (true) {
        const resp = await this.transport.pull(curCursor, 200);

        if (resp.ops.length === 0) break;

        // Validate schema compatibility
        const neg = this.negotiateSchema(resp.serverSchemaVersion);
        if (!neg.compatible) {
          errors.push(
            `schema version incompatible: client=${SYNC_SCHEMA_VERSION} server=${resp.serverSchemaVersion}`,
          );
          break;
        }

        // Apply ops — collect corrupt ones for quarantine
        const { errors: applyErrors } = applyOps(resp.ops, this.store);
        for (const ae of applyErrors) {
          errors.push(`apply error for op ${ae.opId}: ${ae.reason}`);
          // Quarantine corrupt inbound ops (F864)
          // Note: inbound ops from server live in a separate quarantine list
          // (we don't have them in the outbox, so just log)
        }

        pulled += resp.ops.length;
        this.health.appliedOps += resp.ops.length - applyErrors.length;

        // Advance lamport clock to max seen
        for (const op of resp.ops) {
          if (op.lamport > this.lamport) this.lamport = op.lamport;
        }

        // Persist cursor after each successful page (F837)
        const lastOp = resp.ops[resp.ops.length - 1];
        if (lastOp !== undefined) {
          // Server seq carried on each op; use the last one
          // (server assigns seq separately from lamport; ops carry it via id convention)
          // We rely on nextCursor from the response to advance.
        }

        if (resp.nextCursor === null) {
          // Fully caught up
          this.cursorStorage.save(
            decodeCursor(resp.nextCursor ?? encodeCursor(INITIAL_CURSOR)).serverSeq,
          );
          break;
        }

        curCursor = resp.nextCursor;
        // Persist cursor after each page so interruption doesn't re-pull
        const parsed = decodeCursor(curCursor);
        this.cursorStorage.save(parsed.serverSeq);
      }

      this.health.lastSyncAt = new Date().toISOString();
      this.health.consecutiveFailures = 0;
      this.health.lastError = null;
      this.health.lastErrorAt = null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`pull failed: ${msg}`);
      this.recordFailure(msg);
    }

    return { pushed, pulled, errors };
  }

  /**
   * Compute the delay to wait before retrying after the Nth consecutive failure.
   * Pure delegation to backoff module (F861).
   */
  backoffDelay(consecutiveFailures: number, random?: () => number): number {
    const result = computeBackoff(consecutiveFailures, this.config.backoff, random);
    return result.shouldGiveUp ? -1 : result.delayMs;
  }

  private recordFailure(msg: string): void {
    this.health.consecutiveFailures++;
    this.health.lastError = msg;
    this.health.lastErrorAt = new Date().toISOString();
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
