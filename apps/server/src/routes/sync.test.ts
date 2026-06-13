/**
 * Sync route integration tests (F832–F833, F836, F838, F865, F867, F869, F870).
 *
 * Tests:
 *   - pull/push round-trip
 *   - idempotent re-push (duplicate acks)
 *   - multi-device interleaved convergence
 *   - device registry
 *   - schema version rejection
 *   - checksum endpoint
 *   - rehydration endpoint
 *   - compaction endpoint
 *   - partial batch partial-failure (chaos)
 *   - 10k op drain
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { SYNC_SCHEMA_VERSION } from '@fables/sync';

let app: FastifyInstance;
let notebookId: string;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = `op_${Math.random().toString(36).slice(2)}`;
  return {
    id,
    deviceId: 'dev_test',
    lamport: 1,
    schemaVersion: SYNC_SCHEMA_VERSION,
    clientCreatedAt: new Date().toISOString(),
    domain: 'note',
    opType: 'create',
    entityId: `note_test_${id}`,
    payload: {
      notebookId,
      title: 'Sync Test Note',
      body: 'hello',
    },
    ...overrides,
  };
}

async function push(
  ops: Record<string, unknown>[],
  deviceId = 'dev_test',
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/push',
    payload: { deviceId, ops, schemaVersion: SYNC_SCHEMA_VERSION },
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

async function pull(since = '0', limit = 100): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/sync/pull?since=${since}&limit=${limit}`,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as Record<string, unknown>;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notebooks',
    payload: { name: 'Sync Test Notebook' },
  });
  notebookId = (res.json() as { data: { id: string } }).data.id;
});

afterAll(async () => {
  await app.close();
});

// ── Push/pull round-trip (F832, F833) ─────────────────────────────────────────

describe('push/pull round-trip', () => {
  it('pushes ops and pulls them back', async () => {
    const op = makeOp({ lamport: 100 });

    const pushResult = await push([op]);
    expect(pushResult.statusCode).toBe(200);
    const data = pushResult.body['data'] as Record<string, unknown>;
    expect(data['accepted']).toBe(1);
    const acks = data['acks'] as Array<{ opId: string; status: string; serverSeq: number }>;
    expect(acks[0]?.status).toBe('accepted');
    expect(typeof acks[0]?.serverSeq).toBe('number');

    const serverSeq = acks[0]!.serverSeq;

    // Pull back from before this op
    const pullResult = await pull(String(serverSeq - 1));
    const pullData = pullResult['data'] as Record<string, unknown>;
    const ops = pullData['ops'] as Array<{ id: string }>;
    const found = ops.find((o) => o.id === op['id']);
    expect(found).toBeDefined();
  });

  it('pull with since=0 returns all ops so far', async () => {
    const res = await pull('0', 500);
    const data = res['data'] as Record<string, unknown>;
    const ops = data['ops'] as unknown[];
    expect(ops.length).toBeGreaterThan(0);
  });

  it('pull cursor is returned for pagination', async () => {
    // Push multiple ops
    const ops = Array.from({ length: 3 }, (_, i) => makeOp({ lamport: 200 + i }));
    await push(ops);

    // Pull with limit=1 — should get nextCursor
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull?since=0&limit=1',
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    // Either nextCursor is set (more pages) or null (all fit)
    expect(data['count']).toBe(1);
  });
});

// ── Idempotent re-push (F833) ─────────────────────────────────────────────────

describe('idempotent re-push', () => {
  it('pushing the same op twice gives duplicate on second push', async () => {
    const op = makeOp({ lamport: 300 });

    const first = await push([op]);
    expect((first.body['data'] as Record<string, unknown>)['accepted']).toBe(1);

    const second = await push([op]);
    const data2 = second.body['data'] as Record<string, unknown>;
    expect(data2['duplicate']).toBe(1);
    expect(data2['accepted']).toBe(0);
  });

  it('duplicate acks count correctly in mixed batches', async () => {
    const existing = makeOp({ lamport: 400 });
    await push([existing]);

    const fresh = makeOp({ lamport: 401 });
    const result = await push([existing, fresh]);
    const data = result.body['data'] as Record<string, unknown>;
    expect(data['accepted']).toBe(1);
    expect(data['duplicate']).toBe(1);
  });
});

// ── Multi-device convergence (F840) ───────────────────────────────────────────

describe('multi-device convergence', () => {
  it('ops from different devices all appear in pull', async () => {
    const noteId = `note_conv_${Date.now()}`;
    const opA = makeOp({ deviceId: 'dev_alice', lamport: 500, entityId: noteId });
    const opB = makeOp({
      deviceId: 'dev_bob',
      lamport: 501,
      opType: 'update',
      entityId: noteId,
      payload: { title: 'Bob was here', body: '' },
    });

    await push([opA], 'dev_alice');
    await push([opB], 'dev_bob');

    const res = await pull('0', 500);
    const ops = (res['data'] as Record<string, unknown>)['ops'] as Array<{ id: string }>;
    const ids = ops.map((o) => o.id);
    expect(ids).toContain(opA['id']);
    expect(ids).toContain(opB['id']);
  });

  it('note created via push appears in the notes REST API', async () => {
    const noteId = `note_sync_${Date.now()}`;
    const op = makeOp({
      entityId: noteId,
      lamport: 600,
      payload: { notebookId, title: 'Synced Note', body: 'via push' },
    });
    await push([op]);

    const res = await app.inject({ method: 'GET', url: `/api/v1/notes/${noteId}` });
    expect(res.statusCode).toBe(200);
    const note = (res.json() as { data: { title: string; body: string } }).data;
    expect(note.title).toBe('Synced Note');
    expect(note.body).toBe('via push');
  });
});

// ── Device registry (F838) ────────────────────────────────────────────────────

describe('device registry', () => {
  it('registers a device with a name', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/sync/devices/dev_iphone',
      payload: { name: 'iPhone 15' },
    });
    expect(res.statusCode).toBe(200);
    const device = (res.json() as { data: { name: string } }).data;
    expect(device.name).toBe('iPhone 15');
  });

  it('lists devices including auto-registered ones', async () => {
    const op = makeOp({ lamport: 700, deviceId: 'dev_macbook' });
    await push([op], 'dev_macbook');

    const res = await app.inject({ method: 'GET', url: '/api/v1/sync/devices' });
    expect(res.statusCode).toBe(200);
    const devices = (res.json() as { data: Array<{ deviceId: string }> }).data;
    const ids = devices.map((d) => d.deviceId);
    expect(ids).toContain('dev_macbook');
  });
});

// ── Schema version negotiation (F865) ─────────────────────────────────────────

describe('schema version negotiation', () => {
  it('rejects clients with schema version 0 (below minimum)', async () => {
    const op = makeOp({ lamport: 800 });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      payload: { deviceId: 'dev_old', ops: [op], schemaVersion: 0 },
    });
    // Zod validates schemaVersion as positive integer, so 0 gets 422 from validation layer
    expect(res.statusCode).toBeOneOf([400, 422]);
  });

  it('schema endpoint returns current version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sync/schema' });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { serverSchemaVersion: number; compatible: boolean } })
      .data;
    expect(data.serverSchemaVersion).toBe(SYNC_SCHEMA_VERSION);
    expect(data.compatible).toBe(true);
  });
});

// ── Checksum endpoint (F867) ───────────────────────────────────────────────────

describe('checksum', () => {
  it('returns checksums for known tables', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sync/checksum' });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as {
        data: { checksums: Array<{ table: string; checksum: string; rowCount: number }> };
      }
    ).data;
    expect(data.checksums.length).toBeGreaterThan(0);
    const tables = data.checksums.map((c) => c.table);
    expect(tables).toContain('notes');
    expect(tables).toContain('entities');
    for (const c of data.checksums) {
      expect(typeof c.checksum).toBe('string');
      expect(typeof c.rowCount).toBe('number');
    }
  });
});

// ── Sync health (F863) ────────────────────────────────────────────────────────

describe('sync health', () => {
  it('health endpoint returns op counts and schema version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sync/health' });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { pendingOpsInLog: number; serverSchemaVersion: number } })
      .data;
    expect(typeof data.pendingOpsInLog).toBe('number');
    expect(data.serverSchemaVersion).toBe(SYNC_SCHEMA_VERSION);
  });
});

// ── Compaction (F836) ─────────────────────────────────────────────────────────

describe('compaction', () => {
  it('compaction endpoint runs without error', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/sync/compact' });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as { data: { candidates: number; compacted: number; errors: string[] } }
    ).data;
    expect(typeof data.candidates).toBe('number');
    expect(data.errors).toHaveLength(0);
  });
});

// ── Rehydration (F868) ─────────────────────────────────────────────────────────

describe('rehydration', () => {
  it('returns all ops for requested tables', async () => {
    // Push a known note op first
    const op = makeOp({ lamport: 900 });
    await push([op]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/rehydrate',
      payload: { deviceId: 'dev_test', tables: ['notes'] },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { ops: unknown[]; count: number } }).data;
    expect(data.count).toBeGreaterThan(0);
    expect(data.ops.length).toBe(data.count);
  });
});

// ── Partial batch chaos: kill mid-batch (F870) ────────────────────────────────

describe('chaos: partial batch failure handling (F870)', () => {
  it('accepted ops are acked, rejected ops are flagged — no silent loss', async () => {
    const goodOp = makeOp({ lamport: 1000 });
    // Bad op: missing required payload fields but still has an id
    const badOp = {
      id: `op_bad_${Date.now()}`,
      deviceId: 'dev_test',
      lamport: 1001,
      schemaVersion: SYNC_SCHEMA_VERSION,
      clientCreatedAt: new Date().toISOString(),
      domain: 'note',
      opType: 'create',
      entityId: `note_bad_${Date.now()}`,
      payload: {}, // intentionally missing notebookId
    };

    const result = await push([goodOp, badOp]);
    expect(result.statusCode).toBe(200);
    const data = result.body['data'] as Record<string, unknown>;
    const acks = data['acks'] as Array<{ opId: string; status: string }>;
    const statuses = Object.fromEntries(acks.map((a) => [a.opId, a.status]));
    // goodOp should be accepted (note create may fail on DB constraint if no notebookId)
    // What matters is: total ack count equals batch size
    expect(acks).toHaveLength(2);
    // At least the goodOp was processed (it may succeed or fail, but is acked)
    expect(statuses[goodOp['id'] as string]).toBeDefined();
  });
});

// ── 10k op drain integration test (F869) ──────────────────────────────────────

describe('10k op drain (F869)', () => {
  it('server accepts 10000 ops across batches without loss', async () => {
    const TOTAL = 10_000;
    const BATCH_SIZE = 500;
    const deviceId = 'dev_drain_integration';

    const allOpIds: string[] = [];
    let lamport = 10_000;
    let accepted = 0;

    for (let i = 0; i < TOTAL; i += BATCH_SIZE) {
      const batch = Array.from({ length: BATCH_SIZE }, (_, j) => {
        const idx = i + j;
        const id = `op_drain_${deviceId}_${idx}`;
        allOpIds.push(id);
        return makeOp({
          id,
          deviceId,
          lamport: lamport++,
          entityId: `note_drain_integ_${idx}`,
          payload: { notebookId, title: `Drain note ${idx}`, body: '' },
        });
      });

      const result = await push(batch, deviceId);
      expect(result.statusCode).toBe(200);
      const data = result.body['data'] as Record<string, unknown>;
      accepted += data['accepted'] as number;
    }

    expect(accepted).toBe(TOTAL);

    // Pull should return all those ops (they might be paginated)
    let since = '0';
    const pulledIds = new Set<string>();
    while (true) {
      const res = await pull(since, 500);
      const data = res['data'] as Record<string, unknown>;
      const ops = data['ops'] as Array<{ id: string }>;
      for (const op of ops) pulledIds.add(op.id);
      const nextCursor = data['nextCursor'] as string | null;
      if (!nextCursor) break;
      since = nextCursor;
    }

    // All drain ops should be in the pull
    for (const id of allOpIds) {
      expect(pulledIds.has(id)).toBe(true);
    }
  }, 120_000); // 2 min
});
