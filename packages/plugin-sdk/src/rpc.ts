/**
 * Structured RPC protocol between host and plugin worker (F1012).
 *
 * All messages flow over worker_threads postMessage. The host sends
 * `HostRpcRequest` objects; the worker replies with `WorkerRpcResponse`.
 * The worker sends `WorkerRpcRequest` for capability calls; the host
 * replies with `HostRpcResponse`.
 *
 * Message IDs are ULIDs generated at send-time to correlate responses.
 */

// ── Capability call targets (worker → host) ──────────────────────────────────

export type NoteQueryParams = {
  fql?: string;
  limit?: number;
  cursor?: string;
};

export type NoteWriteParams = {
  notebookId: string;
  title: string;
  body?: string;
};

export type NoteUpdateParams = {
  id: string;
  rev: number;
  title?: string;
  body?: string;
};

export type SearchExtendParams = {
  query: string;
  limit?: number;
};

export type CapabilityCall =
  | { cap: 'notes.query'; params: NoteQueryParams }
  | { cap: 'notes.get'; params: { id: string } }
  | { cap: 'notes.create'; params: NoteWriteParams }
  | { cap: 'notes.update'; params: NoteUpdateParams }
  | { cap: 'notes.tags'; params: { noteId: string } }
  | { cap: 'tags.list'; params: Record<string, never> }
  | { cap: 'search.extend'; params: SearchExtendParams }
  | { cap: 'storage.get'; params: { key: string } }
  | { cap: 'storage.set'; params: { key: string; value: string } }
  | { cap: 'storage.delete'; params: { key: string } }
  | { cap: 'event.subscribe'; params: { event: string } }
  | { cap: 'event.unsubscribe'; params: { event: string } }
  | { cap: 'vm.registerFunction'; params: VmFunctionRegistration }
  | { cap: 'vm.registerEffect'; params: VmEffectRegistration }
  | { cap: 'vm.readState'; params: { storyId: string; key: string } }
  | { cap: 'http.fetch'; params: HttpFetchParams };

export type VmFunctionRegistration = {
  name: string;
  deterministic: boolean;
  parameters: string[];
};

export type VmEffectRegistration = {
  name: string;
};

export type HttpFetchParams = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

// ── Worker → Host (capability request) ──────────────────────────────────────

export interface WorkerRpcRequest {
  type: 'cap_call';
  id: string;
  call: CapabilityCall;
}

/** Host responds to a capability call. */
export interface HostRpcResponse {
  type: 'cap_response';
  id: string;
  ok: true;
  result: unknown;
}

export interface HostRpcError {
  type: 'cap_response';
  id: string;
  ok: false;
  error: string;
}

// ── Host → Worker (plugin invocation) ────────────────────────────────────────

export type PluginCallTarget =
  | { method: 'onLoad'; args: [] }
  | { method: 'onUnload'; args: [] }
  | { method: 'onEvent'; args: [event: string, payload: unknown] }
  | { method: 'onNotePostProcess'; args: [markdown: string, noteId: string] }
  | { method: 'onSearchExtend'; args: [query: string] }
  | { method: 'onVmFunction'; args: [name: string, vmArgs: unknown[]] }
  | { method: 'onVmEffect'; args: [name: string, vmArgs: unknown[]] }
  | { method: 'onPreChoice'; args: [storyId: string, choiceIndex: number] }
  | { method: 'onPostChoice'; args: [storyId: string, choiceIndex: number, result: unknown] }
  | { method: 'onExportFormat'; args: [formatId: string, storyId: string] };

export interface HostRpcRequest {
  type: 'plugin_call';
  id: string;
  target: PluginCallTarget;
}

export interface WorkerRpcResponse {
  type: 'plugin_response';
  id: string;
  ok: true;
  result: unknown;
}

export interface WorkerRpcError {
  type: 'plugin_response';
  id: string;
  ok: false;
  error: string;
}

// ── Worker ready signal ───────────────────────────────────────────────────────

export interface WorkerReadyMessage {
  type: 'ready';
  pluginId: string;
}

export interface WorkerLogMessage {
  type: 'log';
  level: 'info' | 'warn' | 'error';
  message: string;
}

// ── Union types ───────────────────────────────────────────────────────────────

export type WorkerMessage =
  | WorkerRpcRequest
  | WorkerRpcResponse
  | WorkerRpcError
  | WorkerReadyMessage
  | WorkerLogMessage;

export type HostMessage = HostRpcRequest | HostRpcResponse | HostRpcError;
