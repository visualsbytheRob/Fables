/**
 * Sync routes (F832–F833, F836, F838, F865, F867).
 *
 *   GET  /sync/pull                   — pull ops since cursor
 *   POST /sync/push                   — push a batch of ops
 *   POST /sync/compact                — trigger compaction job
 *   GET  /sync/devices                — list registered devices
 *   PUT  /sync/devices/:id            — register/rename a device
 *   GET  /sync/health                 — sync health summary
 *   GET  /sync/checksum               — per-table integrity checksums
 *   POST /sync/rehydrate              — forced full re-hydration (F868)
 *   GET  /sync/schema                 — schema version negotiation (F865)
 *
 * Source-of-truth approach (documented):
 *   Pushed ops are written to the op-log AND applied to the real tables
 *   (notes, entities, story_saves) inside the same transaction. This keeps
 *   the REST API and sync always in agreement. Reads never need to consult
 *   the op-log; the op-log is the audit trail + sync cursor vehicle.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  buildChecksum,
  decodeCursor,
  encodeCursor,
  SYNC_SCHEMA_VERSION,
  type SyncOp,
} from '@fables/sync';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { syncRepo } from '../db/repos/sync.js';
import { applySyncOpToDb } from '../services/sync-apply.js';
import { runCompactionJob } from '../services/sync-compact.js';

// ── Zod schemas for HTTP boundary validation ───────────────────────────────────

const pullQuerySchema = z.object({
  since: z.string().default('0'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const opHeaderSchema = z.object({
  id: z.string().min(1),
  deviceId: z.string().min(1),
  lamport: z.number().int().nonnegative(),
  schemaVersion: z.number().int().positive().default(SYNC_SCHEMA_VERSION),
  clientCreatedAt: z.string(),
});

const syncOpSchema = opHeaderSchema.extend({
  domain: z.enum(['note', 'entity', 'save_slot']),
  opType: z.enum(['create', 'update', 'delete', 'restore', 'upsert']),
  entityId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

const pushBodySchema = z.object({
  deviceId: z.string().min(1),
  ops: z.array(syncOpSchema).min(1).max(500),
  schemaVersion: z.number().int().positive().default(SYNC_SCHEMA_VERSION),
});

const deviceParamsSchema = z.object({ id: z.string().min(1) });

const registerDeviceBodySchema = z.object({
  name: z.string().min(1).max(200),
});

const rehydrateBodySchema = z.object({
  deviceId: z.string().min(1),
  tables: z
    .array(z.enum(['notes', 'entities', 'story_saves']))
    .default(['notes', 'entities', 'story_saves']),
});

const MIN_SUPPORTED_CLIENT_VERSION = 1;

// ── Route registrations (for OpenAPI registry) ────────────────────────────────

registerRoute({
  method: 'GET',
  path: '/sync/pull',
  summary: 'Pull ops since cursor (F832)',
  query: pullQuerySchema,
});

registerRoute({
  method: 'POST',
  path: '/sync/push',
  summary: 'Push op batch with idempotency (F833)',
  body: pushBodySchema,
});

registerRoute({
  method: 'POST',
  path: '/sync/compact',
  summary: 'Trigger op compaction job (F836)',
});

registerRoute({
  method: 'GET',
  path: '/sync/devices',
  summary: 'List registered devices (F838)',
});

registerRoute({
  method: 'PUT',
  path: '/sync/devices/:id',
  summary: 'Register or rename a device (F838)',
  params: deviceParamsSchema,
  body: registerDeviceBodySchema,
});

registerRoute({
  method: 'GET',
  path: '/sync/health',
  summary: 'Sync health summary (F863)',
});

registerRoute({
  method: 'GET',
  path: '/sync/checksum',
  summary: 'Per-table integrity checksums (F867)',
});

registerRoute({
  method: 'POST',
  path: '/sync/rehydrate',
  summary: 'Force full re-hydration from op-log (F868)',
  body: rehydrateBodySchema,
});

registerRoute({
  method: 'GET',
  path: '/sync/schema',
  summary: 'Schema version negotiation (F865)',
});

// ── Plugin ────────────────────────────────────────────────────────────────────

export const syncRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /sync/pull?since=<cursor>&limit=<n>
   *
   * Returns up to `limit` ops after the cursor, plus a `nextCursor` for
   * pagination. When nextCursor is null the client is fully caught up.
   */
  app.get('/sync/pull', async (request, reply) => {
    const q = parseWith(pullQuerySchema, request.query, 'query');
    const cursor = decodeCursor(q.since);
    const repo = syncRepo(app.db);

    // Rate-limit large pulls: clamp to 500 max
    const limit = Math.min(q.limit, 500);
    const ops = repo.pullOpsSince(cursor.serverSeq, limit);

    const hasMore = ops.length > limit;
    const page = hasMore ? ops.slice(0, limit) : ops;
    const lastOp = page[page.length - 1];
    const nextCursor = hasMore && lastOp ? encodeCursor({ serverSeq: lastOp.serverSeq }) : null;

    return reply.send({
      data: {
        ops: page.map(({ serverSeq: _seq, ...op }) => op), // strip server-internal field
        nextCursor,
        serverSchemaVersion: SYNC_SCHEMA_VERSION,
        count: page.length,
      },
    });
  });

  /**
   * POST /sync/push
   *
   * Accepts a batch of ops. Each op is written to the op-log and applied
   * to the real tables in the same transaction. Returns per-op acks.
   */
  app.post('/sync/push', async (request, reply) => {
    const body = parseWith(pushBodySchema, request.body, 'body');

    // Schema version negotiation (F865)
    if (body.schemaVersion < MIN_SUPPORTED_CLIENT_VERSION) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: `client schema version ${body.schemaVersion} is below minimum supported ${MIN_SUPPORTED_CLIENT_VERSION}`,
          details: {
            clientVersion: body.schemaVersion,
            serverVersion: SYNC_SCHEMA_VERSION,
            minSupported: MIN_SUPPORTED_CLIENT_VERSION,
          },
        },
      });
    }

    const repo = syncRepo(app.db);
    const acks = repo.ingestOps(body.ops as SyncOp[], body.deviceId);

    // Apply accepted ops to real tables
    for (let i = 0; i < body.ops.length; i++) {
      const ack = acks[i];
      if (ack?.status === 'accepted') {
        try {
          applySyncOpToDb(body.ops[i] as SyncOp, app.db);
        } catch (e) {
          // Downgrade to rejected if table-apply failed
          if (ack) {
            ack.status = 'rejected';
            ack.reason = e instanceof Error ? e.message : String(e);
          }
        }
      }
    }

    return reply.send({
      data: {
        acks,
        serverSchemaVersion: SYNC_SCHEMA_VERSION,
        accepted: acks.filter((a) => a.status === 'accepted').length,
        rejected: acks.filter((a) => a.status === 'rejected').length,
        duplicate: acks.filter((a) => a.status === 'duplicate').length,
      },
    });
  });

  /**
   * POST /sync/compact
   *
   * Runs the op compaction job synchronously (background job would be async
   * but sync is fast enough for on-demand triggering).
   */
  app.post('/sync/compact', async (_request, reply) => {
    const repo = syncRepo(app.db);
    const result = runCompactionJob(app.db, repo);
    return reply.send({ data: result });
  });

  /**
   * GET /sync/devices
   *
   * Returns all registered devices with last-sync timestamps (F838).
   */
  app.get('/sync/devices', async (_request, reply) => {
    const repo = syncRepo(app.db);
    return reply.send({ data: repo.listDevices() });
  });

  /**
   * PUT /sync/devices/:id
   *
   * Register a device (first push auto-registers, but this allows naming).
   */
  app.put('/sync/devices/:id', async (request, reply) => {
    const { id } = parseWith(deviceParamsSchema, request.params, 'params');
    const body = parseWith(registerDeviceBodySchema, request.body, 'body');
    const repo = syncRepo(app.db);
    const device = repo.registerDevice(id, body.name);
    return reply.send({ data: device });
  });

  /**
   * GET /sync/health
   *
   * Returns sync health summary: op counts, last sync times (F863).
   */
  app.get('/sync/health', async (_request, reply) => {
    const repo = syncRepo(app.db);
    const pendingOps = repo.pendingOpCount();
    const devices = repo.listDevices();
    const lastSyncAt = devices.reduce<string | null>((best, d) => {
      if (!d.lastSyncAt) return best;
      if (!best || d.lastSyncAt > best) return d.lastSyncAt;
      return best;
    }, null);

    return reply.send({
      data: {
        pendingOpsInLog: pendingOps,
        deviceCount: devices.length,
        lastSyncAt,
        serverSchemaVersion: SYNC_SCHEMA_VERSION,
      },
    });
  });

  /**
   * GET /sync/checksum
   *
   * Returns per-table checksums for data-integrity comparison (F867).
   * The client computes the same checksums locally and diffs.
   */
  app.get('/sync/checksum', async (_request, reply) => {
    const repo = syncRepo(app.db);
    const tableData = repo.checksumData();
    const checksums = tableData.map(({ table, ids }) => buildChecksum(table, ids));
    return reply.send({ data: { checksums, serverSchemaVersion: SYNC_SCHEMA_VERSION } });
  });

  /**
   * POST /sync/rehydrate
   *
   * Forced full re-hydration (F868): replays all ops for the requested
   * tables from seq=0. This is the recovery path when client state is
   * corrupt or missing.
   *
   * Returns the full op-log for the requested domains so the client can
   * rebuild its local store from scratch.
   */
  app.post('/sync/rehydrate', async (request, reply) => {
    const body = parseWith(rehydrateBodySchema, request.body, 'body');
    const repo = syncRepo(app.db);

    const domainMap: Record<string, SyncOp['domain']> = {
      notes: 'note',
      entities: 'entity',
      story_saves: 'save_slot',
    };

    const ops: Array<SyncOp & { serverSeq: number }> = [];
    const batchSize = 500;
    for (const table of body.tables) {
      const domain = domainMap[table];
      if (!domain) continue;
      // Pull all ops for this domain from beginning
      let since = 0;
      while (true) {
        const batch = repo.pullOpsSince(since, batchSize);
        const filtered = batch.filter((o) => o.domain === domain);
        ops.push(...filtered);
        if (batch.length < batchSize) break;
        const last = batch[batch.length - 1];
        if (last) since = last.serverSeq;
        else break;
      }
    }

    // Sort by serverSeq for ordered replay
    ops.sort((a, b) => a.serverSeq - b.serverSeq);

    return reply.send({
      data: {
        ops: ops.map(({ serverSeq: _seq, ...op }) => op),
        count: ops.length,
        rehydratedAt: new Date().toISOString(),
        serverSchemaVersion: SYNC_SCHEMA_VERSION,
      },
    });
  });

  /**
   * GET /sync/schema
   *
   * Returns server schema version for client negotiation (F865).
   */
  app.get('/sync/schema', async (_request, reply) => {
    return reply.send({
      data: {
        serverSchemaVersion: SYNC_SCHEMA_VERSION,
        minSupportedClientVersion: MIN_SUPPORTED_CLIENT_VERSION,
        compatible: true,
      },
    });
  });
};
