/**
 * Plugin sandbox manager (F1011–F1020).
 *
 * Manages the lifecycle of plugin worker threads:
 *  - Spawning workers with CPU/memory resource limits (F1013)
 *  - RPC bridge between host and worker (F1012)
 *  - Crash isolation + auto-restart with exponential backoff (F1016)
 *  - Timeout on all plugin calls (F1017)
 *  - Capability audit logging (F1018)
 *  - Permission enforcement at host side (F1014, F1015)
 */

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type {
  CapabilityCall,
  HostMessage,
  HostRpcRequest,
  WorkerMessage,
  WorkerRpcRequest,
  PluginCallTarget,
} from '@fables/plugin-sdk';
import type { Db } from '../db/connection.js';
import { pluginsRepo } from '../db/repos/plugins.js';
import { buildCapabilityHandler } from './capability-handler.js';

const WORKER_SCRIPT = fileURLToPath(
  new URL('./sandbox-worker.js', import.meta.url),
);

/** Maximum time (ms) to wait for a plugin call to complete. */
const CALL_TIMEOUT_MS = 5_000;

/** Maximum auto-restarts before giving up. */
const MAX_RESTARTS = 3;

/** Exponential backoff delays (ms) for restarts. */
const BACKOFF_MS = [1_000, 5_000, 30_000];

/** CPU and memory budgets per plugin (F1013). */
const RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 64,
  maxYoungGenerationSizeMb: 16,
  codeRangeSizeMb: 16,
  stackSizeMb: 4,
};

interface PendingCall {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PluginSandbox {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingCall>();
  private restartCount = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private subscriptions = new Set<string>();

  constructor(
    private readonly pluginId: string,
    private readonly entryPath: string,
    private readonly permissions: string[],
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    private readonly onEvent?: (pluginId: string, event: string, payload: unknown, idempotencyKey: string) => void,
  ) {}

  /** Spawn the worker and wait for the ready signal. */
  async start(): Promise<void> {
    await this.spawnWorker();
  }

  private async spawnWorker(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Resolve the actual worker script path (dist vs src)
      let workerScript = WORKER_SCRIPT;
      // In test/dev, the ts file might not be compiled yet — tsx handles it
      // We use __filename convention to find the peer file
      const workerTs = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        'sandbox-worker.ts',
      );
      // Use .ts source if running under tsx (NODE_OPTIONS includes --import tsx)
      if (process.env['NODE_OPTIONS']?.includes('tsx') || process.env['npm_lifecycle_script']?.includes('tsx')) {
        workerScript = workerTs;
      }

      const worker = new Worker(workerScript, {
        workerData: {
          pluginId: this.pluginId,
          entryPath: this.entryPath,
          permissions: this.permissions,
        },
        resourceLimits: RESOURCE_LIMITS,
        // Pass current NODE_OPTIONS so tsx works in the worker
        env: { ...process.env },
      });

      this.worker = worker;

      const readyTimer = setTimeout(() => {
        reject(new Error(`plugin "${this.pluginId}" worker did not send ready signal within 10s`));
        worker.terminate().catch(() => {});
      }, 10_000);

      worker.on('message', (msg: WorkerMessage) => {
        if (msg.type === 'ready') {
          clearTimeout(readyTimer);
          this.log.info({ pluginId: this.pluginId }, 'plugin worker ready');
          resolve();
        } else {
          this.handleWorkerMessage(msg);
        }
      });

      worker.on('error', (err) => {
        clearTimeout(readyTimer);
        this.log.error({ pluginId: this.pluginId, err }, 'plugin worker error');
        this.scheduleRestart();
        reject(err);
      });

      worker.on('exit', (code) => {
        clearTimeout(readyTimer);
        if (!this.stopped) {
          this.log.warn({ pluginId: this.pluginId, code }, 'plugin worker exited unexpectedly');
          this.scheduleRestart();
        }
        this.rejectAllPending(new Error(`plugin worker exited (code ${code})`));
      });
    });
  }

  private handleWorkerMessage(msg: WorkerMessage): void {
    switch (msg.type) {
      case 'plugin_response': {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.ok) {
          pending.resolve(msg.result);
        } else {
          pending.reject(new Error(msg.error));
        }
        break;
      }
      case 'cap_call': {
        const req = msg as WorkerRpcRequest;
        this.handleCapCall(req).catch((e) => {
          this.log.warn({ pluginId: this.pluginId, cap: req.call.cap, err: e }, 'cap call error');
        });
        break;
      }
      case 'log': {
        const level = msg.level;
        this.log[level]({ pluginId: this.pluginId }, `[plugin] ${msg.message}`);
        break;
      }
    }
  }

  private async handleCapCall(req: WorkerRpcRequest): Promise<void> {
    const { id, call } = req;
    const repo = pluginsRepo(this.db);

    // Permission check (F1014, F1015)
    const allowed = this.checkPermission(call);
    if (!allowed.ok) {
      const err: HostMessage = {
        type: 'cap_response',
        id,
        ok: false,
        error: `permission denied: ${allowed.reason}`,
      };
      this.send(err);
      repo.appendAudit({
        id: crypto.randomUUID(),
        pluginId: this.pluginId,
        cap: call.cap,
        params: call.params,
        ok: false,
        errorMsg: `permission denied: ${allowed.reason}`,
      });
      return;
    }

    // Handle event subscribe/unsubscribe
    if (call.cap === 'event.subscribe') {
      this.subscriptions.add(call.params.event);
      const resp: HostMessage = { type: 'cap_response', id, ok: true, result: null };
      this.send(resp);
      return;
    }
    if (call.cap === 'event.unsubscribe') {
      this.subscriptions.delete(call.params.event);
      const resp: HostMessage = { type: 'cap_response', id, ok: true, result: null };
      this.send(resp);
      return;
    }

    // Dispatch to capability handler
    const handler = buildCapabilityHandler(this.db, this.pluginId);
    let result: unknown;
    let ok = true;
    let errorMsg: string | undefined;

    try {
      result = await handler(call as CapabilityCall);
    } catch (e) {
      ok = false;
      errorMsg = (e as Error).message;
    }

    // Audit log
    const auditEntry: Parameters<typeof repo.appendAudit>[0] = {
      id: crypto.randomUUID(),
      pluginId: this.pluginId,
      cap: call.cap,
      params: call.params,
      ok,
    };
    if (errorMsg !== undefined) auditEntry.errorMsg = errorMsg;
    repo.appendAudit(auditEntry);

    if (ok) {
      const resp: HostMessage = { type: 'cap_response', id, ok: true, result: result ?? null };
      this.send(resp);
    } else {
      const resp: HostMessage = { type: 'cap_response', id, ok: false, error: errorMsg! };
      this.send(resp);
    }
  }

  private checkPermission(call: CapabilityCall): { ok: true } | { ok: false; reason: string } {
    const cap = call.cap;
    const perms = this.permissions;

    const rules: Record<string, string> = {
      'notes.query': 'notes:read',
      'notes.get': 'notes:read',
      'notes.tags': 'notes:read',
      'tags.list': 'notes:read',
      'notes.create': 'notes:write',
      'notes.update': 'notes:write',
      'search.extend': 'search:extend',
      'storage.get': 'storage',
      'storage.set': 'storage',
      'storage.delete': 'storage',
      'event.subscribe': 'notes:watch',
      'event.unsubscribe': 'notes:watch',
      'vm.registerFunction': 'stories:execute',
      'vm.registerEffect': 'stories:execute',
      'vm.readState': 'stories:read',
      'http.fetch': 'network',
    };

    const required = rules[cap];
    if (!required) return { ok: false, reason: `unknown capability "${cap}"` };
    if (!perms.includes(required)) {
      return { ok: false, reason: `requires permission "${required}" (not granted)` };
    }
    return { ok: true };
  }

  /** Send a message to the worker. */
  private send(msg: HostMessage): void {
    this.worker?.postMessage(msg);
  }

  /** Invoke a plugin lifecycle method with timeout. */
  async call(target: PluginCallTarget): Promise<unknown> {
    if (!this.worker || this.stopped) {
      throw new Error(`plugin "${this.pluginId}" is not running`);
    }

    return new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`plugin "${this.pluginId}" call "${target.method}" timed out after ${CALL_TIMEOUT_MS}ms`));
      }, CALL_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      const req: HostRpcRequest = { type: 'plugin_call', id, target };
      this.send(req);
    });
  }

  /** Deliver an event to the plugin if it has subscribed. */
  async deliverEvent(event: string, payload: unknown, idempotencyKey: string): Promise<void> {
    if (!this.subscriptions.has(event)) return;

    const repo = pluginsRepo(this.db);

    // Replay protection (F1055)
    if (repo.hasSeenEvent(this.pluginId, idempotencyKey)) {
      this.log.debug({ pluginId: this.pluginId, event, idempotencyKey }, 'event already seen, skipping');
      return;
    }
    repo.markEventSeen(this.pluginId, event, idempotencyKey);

    try {
      await this.call({ method: 'onEvent', args: [event, payload] });
    } catch (e) {
      // Failure isolation (F1056): one bad handler never corrupts the chain
      this.log.warn({ pluginId: this.pluginId, event, err: e }, 'plugin event handler error (isolated)');
    }
  }

  private rejectAllPending(err: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private scheduleRestart(): void {
    if (this.stopped) return;
    if (this.restartCount >= MAX_RESTARTS) {
      this.log.error(
        { pluginId: this.pluginId, restarts: this.restartCount },
        'plugin worker exceeded max restarts — quarantining',
      );
      pluginsRepo(this.db).quarantine(
        this.pluginId,
        `worker crashed ${this.restartCount} times and was quarantined`,
      );
      this.stopped = true;
      return;
    }

    const delay = BACKOFF_MS[this.restartCount] ?? 30_000;
    this.restartCount++;
    this.log.warn(
      { pluginId: this.pluginId, attempt: this.restartCount, delayMs: delay },
      'scheduling plugin worker restart',
    );

    this.restartTimer = setTimeout(() => {
      this.spawnWorker().catch((e) => {
        this.log.error({ pluginId: this.pluginId, err: e }, 'plugin worker restart failed');
      });
    }, delay);
  }

  /** Stop the worker gracefully. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.rejectAllPending(new Error('plugin stopped'));
    if (this.worker) {
      try {
        await this.call({ method: 'onUnload', args: [] });
      } catch {
        // best effort
      }
      await this.worker.terminate();
      this.worker = null;
    }
  }

  get isRunning(): boolean {
    return this.worker !== null && !this.stopped;
  }

  get subscribedEvents(): Set<string> {
    return this.subscriptions;
  }
}
