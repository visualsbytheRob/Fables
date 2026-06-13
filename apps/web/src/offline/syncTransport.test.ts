// @vitest-environment jsdom
/**
 * SyncTransport tests (F834).
 * Tests the HTTP transport with mocked fetch.
 * Note: imports @fables/sync types via relative paths since the workspace
 * symlink is created by the orchestrator's `pnpm install`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpSyncTransport } from './syncTransport.js';
// Import constant directly from source to avoid needing workspace symlink
import { SYNC_SCHEMA_VERSION } from '../../../../packages/sync/src/types.js';
import type { SyncOp } from '../../../../packages/sync/src/types.js';

const DEVICE_ID = 'test-device-123';

function makeNoteOp(overrides: Partial<SyncOp> = {}): SyncOp {
  return {
    id: 'op1',
    deviceId: DEVICE_ID,
    lamport: 1,
    schemaVersion: SYNC_SCHEMA_VERSION,
    clientCreatedAt: new Date().toISOString(),
    domain: 'note',
    opType: 'update',
    entityId: 'note-1',
    payload: { title: 'Updated title' },
    ...overrides,
  } as SyncOp;
}

describe('HttpSyncTransport', () => {
  let transport: HttpSyncTransport;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    transport = new HttpSyncTransport(DEVICE_ID);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pull', () => {
    it('calls GET /api/v1/sync/pull with correct params', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              ops: [],
              nextCursor: null,
              serverSchemaVersion: 1,
              count: 0,
            },
          }),
      });

      const result = await transport.pull('42', 100);

      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/v1/sync/pull?since=42&limit=100',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result.ops).toEqual([]);
      expect(result.nextCursor).toBeNull();
      expect(result.serverSchemaVersion).toBe(1);
    });

    it('returns ops from the server', async () => {
      const op = makeNoteOp();
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              ops: [op],
              nextCursor: '50',
              serverSchemaVersion: 1,
              count: 1,
            },
          }),
      });

      const result = await transport.pull('40', 200);

      expect(result.ops).toHaveLength(1);
      expect(result.ops[0]).toEqual(op);
      expect(result.nextCursor).toBe('50');
    });

    it('throws on HTTP error', async () => {
      fetchSpy.mockResolvedValue({ ok: false, status: 503 });

      await expect(transport.pull('0', 100)).rejects.toThrow('sync pull failed: HTTP 503');
    });

    it('encodes special chars in cursor', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ data: { ops: [], nextCursor: null, serverSchemaVersion: 1 } }),
      });

      await transport.pull('0/special', 10);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent('0/special')),
        expect.anything(),
      );
    });
  });

  describe('push', () => {
    it('calls POST /api/v1/sync/push with correct body', async () => {
      const op = makeNoteOp();
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              acks: [{ opId: op.id, status: 'accepted', serverSeq: 1 }],
              serverSchemaVersion: 1,
              accepted: 1,
              rejected: 0,
              duplicate: 0,
            },
          }),
      });

      const result = await transport.push([op], SYNC_SCHEMA_VERSION);

      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/v1/sync/push',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'content-type': 'application/json' }),
        }),
      );

      // Verify body shape
      const body = JSON.parse(
        (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body.deviceId).toBe(DEVICE_ID);
      expect(body.ops).toHaveLength(1);
      expect(body.schemaVersion).toBe(SYNC_SCHEMA_VERSION);

      expect(result.acks).toHaveLength(1);
      expect(result.acks[0]?.status).toBe('accepted');
    });

    it('throws on HTTP error', async () => {
      fetchSpy.mockResolvedValue({ ok: false, status: 400 });

      await expect(transport.push([makeNoteOp()], 1)).rejects.toThrow(
        'sync push failed: HTTP 400',
      );
    });

    it('handles empty acks response', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { acks: [], serverSchemaVersion: 1, accepted: 0, rejected: 0, duplicate: 0 },
          }),
      });

      const result = await transport.push([makeNoteOp()], 1);
      expect(result.acks).toEqual([]);
    });
  });
});
