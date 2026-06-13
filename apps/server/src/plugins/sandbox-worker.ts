/**
 * Plugin sandbox worker entry point (F1011–F1020).
 *
 * This file runs inside a Node worker_threads worker.
 * It receives the plugin manifest + entry path via workerData,
 * loads the plugin code, and bridges capability calls via postMessage RPC.
 *
 * Security model:
 *  - The worker runs plugin code. The host mediates ALL capability access.
 *  - fs/network are NOT available except via granted capability API (F1014, F1015).
 *    We cannot completely monkey-patch node builtins, but:
 *      a) The worker resourceLimits bound CPU/memory (F1013).
 *      b) All capability calls go through the RPC bridge so every access is
 *         audited (F1018).
 *      c) The sandbox-escape test verifies that the policy is enforced at the
 *         host side — the host rejects caps not in the plugin's permissions (F1019).
 *
 * Note: Node worker_threads do NOT support vm.runInNewContext with no-builtins
 * because plugins need dynamic import(). The security enforcement is therefore
 * permission-based at the capability layer (host enforces), not a hard syscall
 * sandbox. Production hardening would add seccomp/nsjail at the process level.
 */

import { parentPort, workerData } from 'node:worker_threads';
import type {
  HostMessage,
  HostRpcRequest,
  HostRpcResponse,
  HostRpcError,
  WorkerMessage,
  WorkerRpcRequest,
  PluginCallTarget,
} from '@fables/plugin-sdk';

interface WorkerConfig {
  pluginId: string;
  entryPath: string;
  permissions: string[];
}

const config = workerData as WorkerConfig;

// Pending cap_call promises: id → { resolve, reject }
const pendingCaps = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

// Plugin lifecycle hooks (populated after plugin load)
let lifecycle: Record<string, unknown> = {};

function send(msg: WorkerMessage): void {
  parentPort!.postMessage(msg);
}

/** Call a host capability over RPC. */
async function callCap(call: WorkerRpcRequest['call']): Promise<unknown> {
  const id = crypto.randomUUID();
  const req: WorkerRpcRequest = { type: 'cap_call', id, call };
  send(req);
  return new Promise<unknown>((resolve, reject) => {
    pendingCaps.set(id, { resolve, reject });
  });
}

/** Build the host API object exposed to plugin code. */
function buildHostApi() {
  const pluginId = config.pluginId;

  const notes = {
    query: (params: object) => callCap({ cap: 'notes.query', params: params as never }),
    get: (id: string) => callCap({ cap: 'notes.get', params: { id } }),
    create: (params: object) => callCap({ cap: 'notes.create', params: params as never }),
    update: (params: object) => callCap({ cap: 'notes.update', params: params as never }),
    tags: (noteId: string) => callCap({ cap: 'notes.tags', params: { noteId } }),
  };

  const tags = {
    list: () => callCap({ cap: 'tags.list', params: {} }),
  };

  const storage = {
    get: (key: string) => callCap({ cap: 'storage.get', params: { key } }),
    set: (key: string, value: string) => callCap({ cap: 'storage.set', params: { key, value } }),
    delete: (key: string) => callCap({ cap: 'storage.delete', params: { key } }),
  };

  const http = {
    fetch: (params: object) => callCap({ cap: 'http.fetch', params: params as never }),
  };

  const story = {
    registerFunction: (params: { name: string; deterministic?: boolean; parameters?: string[]; fn: (...args: unknown[]) => unknown }) => {
      const { fn: _fn, ...registration } = params;
      return callCap({
        cap: 'vm.registerFunction',
        params: {
          name: registration.name,
          deterministic: registration.deterministic ?? true,
          parameters: registration.parameters ?? [],
        },
      });
    },
    registerEffect: (params: { name: string; fn: (...args: unknown[]) => void }) => {
      const { fn: _fn, ...registration } = params;
      return callCap({ cap: 'vm.registerEffect', params: { name: registration.name } });
    },
    readState: (storyId: string, key: string) =>
      callCap({ cap: 'vm.readState', params: { storyId, key } }),
  };

  const eventHandlers = new Map<string, Set<(...args: unknown[]) => unknown>>();

  const events = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set());
        void callCap({ cap: 'event.subscribe', params: { event } });
      }
      eventHandlers.get(event)!.add(handler);
    },
    off: (event: string, handler?: (...args: unknown[]) => unknown) => {
      if (!handler) {
        eventHandlers.delete(event);
        void callCap({ cap: 'event.unsubscribe', params: { event } });
      } else {
        const set = eventHandlers.get(event);
        if (set) {
          set.delete(handler);
          if (set.size === 0) {
            eventHandlers.delete(event);
            void callCap({ cap: 'event.unsubscribe', params: { event } });
          }
        }
      }
    },
  };

  return { pluginId, notes, tags, storage, http, story, events, _eventHandlers: eventHandlers };
}

async function invokeLifecycle(target: PluginCallTarget): Promise<unknown> {
  switch (target.method) {
    case 'onLoad': {
      const fn = lifecycle['onLoad'];
      if (typeof fn === 'function') return fn();
      return undefined;
    }
    case 'onUnload': {
      const fn = lifecycle['onUnload'];
      if (typeof fn === 'function') return fn();
      return undefined;
    }
    case 'onEvent': {
      const [event, payload] = target.args;
      const handlers = (hostApi as ReturnType<typeof buildHostApi>)._eventHandlers.get(event as string);
      if (handlers) {
        for (const h of handlers) {
          await Promise.resolve(h(payload, new Date().toISOString()));
        }
      }
      return undefined;
    }
    case 'onNotePostProcess': {
      const fn = lifecycle['onNotePostProcess'];
      if (typeof fn === 'function') return fn(...target.args);
      return undefined;
    }
    case 'onSearchExtend': {
      const fn = lifecycle['onSearchExtend'];
      if (typeof fn === 'function') return fn(...target.args);
      return [];
    }
    case 'onVmFunction': {
      const [name, vmArgs] = target.args;
      // Registered functions are stored on lifecycle
      const fn = (lifecycle as Record<string, unknown>)[`__vmfn_${name as string}`];
      if (typeof fn === 'function') return fn(...(vmArgs as unknown[]));
      return null;
    }
    case 'onVmEffect': {
      const [name, vmArgs] = target.args;
      const fn = (lifecycle as Record<string, unknown>)[`__vmeff_${name as string}`];
      if (typeof fn === 'function') return fn(...(vmArgs as unknown[]));
      return undefined;
    }
    case 'onPreChoice': {
      const fn = lifecycle['onPreChoice'];
      if (typeof fn === 'function') return fn(...target.args);
      return undefined;
    }
    case 'onPostChoice': {
      const fn = lifecycle['onPostChoice'];
      if (typeof fn === 'function') return fn(...target.args);
      return undefined;
    }
    case 'onExportFormat': {
      const fn = lifecycle['onExportFormat'];
      if (typeof fn === 'function') return fn(...target.args);
      return '';
    }
  }
}

let hostApi: ReturnType<typeof buildHostApi>;

async function main(): Promise<void> {
  if (!parentPort) throw new Error('must run as worker');

  hostApi = buildHostApi();

  // Handle messages from host
  parentPort.on('message', (msg: HostMessage) => {
    if (msg.type === 'cap_response') {
      const pending = pendingCaps.get(msg.id);
      if (!pending) return;
      pendingCaps.delete(msg.id);
      if (msg.ok) {
        pending.resolve((msg as HostRpcResponse).result);
      } else {
        pending.reject(new Error((msg as HostRpcError).error));
      }
    } else if (msg.type === 'plugin_call') {
      const req = msg as HostRpcRequest;
      void (async () => {
        try {
          const result = await invokeLifecycle(req.target);
          const resp: WorkerMessage = {
            type: 'plugin_response',
            id: req.id,
            ok: true,
            result: result ?? null,
          };
          send(resp);
        } catch (e) {
          const resp: WorkerMessage = {
            type: 'plugin_response',
            id: req.id,
            ok: false,
            error: (e as Error).message,
          };
          send(resp);
        }
      })();
    }
  });

  // Load plugin entry
  try {
    // Wrap story.registerFunction to capture the fn in lifecycle
    const originalRegisterFunction = hostApi.story.registerFunction.bind(hostApi.story);
    hostApi.story.registerFunction = async (params) => {
      const { fn, ...rest } = params;
      (lifecycle as Record<string, unknown>)[`__vmfn_${rest.name}`] = fn;
      return originalRegisterFunction({ ...rest, fn });
    };

    const originalRegisterEffect = hostApi.story.registerEffect.bind(hostApi.story);
    hostApi.story.registerEffect = async (params) => {
      const { fn, name } = params;
      (lifecycle as Record<string, unknown>)[`__vmeff_${name}`] = fn;
      return originalRegisterEffect({ name, fn });
    };

    const mod = (await import(config.entryPath)) as { default?: unknown };
    if (typeof mod.default === 'function') {
      lifecycle = (await Promise.resolve(mod.default(hostApi))) as Record<string, unknown>;
    } else {
      lifecycle = {};
    }

    send({ type: 'ready', pluginId: config.pluginId });
  } catch (e) {
    send({
      type: 'plugin_response',
      id: 'load',
      ok: false,
      error: `plugin load failed: ${(e as Error).message}`,
    });
  }
}

void main();
