/**
 * HTTP SyncTransport implementation for the web client (F834).
 *
 * Implements the SyncTransport interface from @fables/sync, calling:
 *   POST /api/v1/sync/push  — push a batch of ops
 *   GET  /api/v1/sync/pull  — pull ops since cursor
 *
 * This is the only file that knows about HTTP; the SyncEngine stays pure.
 */

// NOTE: Once pnpm install links @fables/sync, these relative imports become
// equivalent to "import ... from '@fables/sync'".
import type { SyncTransport, PullResponse, PushResponse } from '@fables/sync';
import type { SyncOp } from '@fables/sync';
import { makeDeviceId } from '@fables/sync';

export { makeDeviceId };

/** Base URL prefix — allows override in tests. */
const API_BASE = '/api/v1';

export class HttpSyncTransport implements SyncTransport {
  constructor(private readonly deviceId: string) {}

  async pull(since: string, limit: number): Promise<PullResponse> {
    const url = `${API_BASE}/sync/pull?since=${encodeURIComponent(since)}&limit=${limit}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`sync pull failed: HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      data: { ops: SyncOp[]; nextCursor: string | null; serverSchemaVersion: number };
    };
    return {
      ops: json.data.ops,
      nextCursor: json.data.nextCursor,
      serverSchemaVersion: json.data.serverSchemaVersion,
    };
  }

  async push(ops: SyncOp[], schemaVersion: number): Promise<PushResponse> {
    const res = await fetch(`${API_BASE}/sync/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ deviceId: this.deviceId, ops, schemaVersion }),
    });

    if (!res.ok) {
      throw new Error(`sync push failed: HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      data: { acks: PushResponse['acks']; serverSchemaVersion: number };
    };
    return {
      acks: json.data.acks,
      serverSchemaVersion: json.data.serverSchemaVersion,
    };
  }
}
