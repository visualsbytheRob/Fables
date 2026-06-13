/**
 * Host capability API surface (F1021–F1040).
 *
 * This is the TypeScript interface a plugin author uses to interact with
 * the host application. At runtime, the SDK bridges these calls to the
 * host over the RPC protocol.
 *
 * Plugin code imports these types; the host implements them.
 */

import type { PluginEventName, PluginEventPayloads } from './events.js';

/** A note as returned by the read API. */
export interface PluginNote {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  rev: number;
  tags: string[];
  attribution?: string;
}

/** Result of a notes query. */
export interface NotesQueryResult {
  notes: PluginNote[];
  nextCursor: string | null;
}

/** Search result contributed by a plugin. */
export interface PluginSearchResult {
  id: string;
  title: string;
  excerpt: string;
  type: string;
  score: number;
  url?: string;
}

/**
 * Notes API (F1021–F1030).
 *
 * Rate-limited: max 100 read calls / 10 write calls per second per plugin.
 * Write API tags notes with the plugin's attribution so changes are auditable.
 */
export interface NotesApi {
  /** Query notes using FQL. Requires notes:read permission. */
  query(params: { fql?: string; limit?: number; cursor?: string }): Promise<NotesQueryResult>;

  /** Get a single note by ID. Requires notes:read permission. */
  get(id: string): Promise<PluginNote | null>;

  /** Create a note with plugin attribution. Requires notes:write permission. */
  create(params: { notebookId: string; title: string; body?: string }): Promise<PluginNote>;

  /** Update a note (optimistic concurrency via rev). Requires notes:write permission. */
  update(params: { id: string; rev: number; title?: string; body?: string }): Promise<PluginNote>;

  /** List tags on a note. Requires notes:read permission. */
  tags(noteId: string): Promise<string[]>;
}

/** Tags API (F1026). */
export interface TagsApi {
  /** List all tags in the vault. Requires notes:read permission. */
  list(): Promise<string[]>;
}

/** Storage API (F1063) — plugin-private key-value store. */
export interface StorageApi {
  /** Get a stored value by key. Requires storage permission. */
  get(key: string): Promise<string | null>;

  /** Set a stored value. Requires storage permission. */
  set(key: string, value: string): Promise<void>;

  /** Delete a stored value. Requires storage permission. */
  delete(key: string): Promise<void>;
}

/** HTTP fetch API. Requires network permission. */
export interface HttpApi {
  fetch(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; body: string; headers: Record<string, string> }>;
}

/**
 * VM/Story API (F1031–F1040).
 *
 * Plugins can register functions and effects into the Forge VM.
 * Requires stories:execute permission.
 */
export interface StoryApi {
  /**
   * Register an external function callable from Forge stories.
   * `fn` is invoked by the host when the VM calls the function.
   * Deterministic functions are safe to call during compilation.
   */
  registerFunction(params: {
    name: string;
    deterministic?: boolean;
    fn: (...args: unknown[]) => unknown | Promise<unknown>;
  }): Promise<void>;

  /**
   * Register a custom effect handler.
   * The fn is called when the story dispatches an effect with this name.
   */
  registerEffect(params: {
    name: string;
    fn: (...args: unknown[]) => void | Promise<void>;
  }): Promise<void>;

  /**
   * Read the current VM state for a story.
   * Requires stories:read permission.
   */
  readState(storyId: string, key: string): Promise<unknown>;
}

/** Event subscription handler type. */
export type EventHandler<T extends PluginEventName> = (
  payload: PluginEventPayloads[T],
  timestamp: string,
) => void | Promise<void>;

/** Events API (F1051–F1060). */
export interface EventsApi {
  /**
   * Subscribe to a typed event.
   * Requires notes:watch for note events, etc.
   */
  on<T extends PluginEventName>(event: T, handler: EventHandler<T>): void;

  /** Unsubscribe from an event. */
  off<T extends PluginEventName>(event: T, handler?: EventHandler<T>): void;
}

/**
 * The full host API surface available to plugin code.
 * This object is passed to the plugin's default export function on load.
 */
export interface PluginHost {
  notes: NotesApi;
  tags: TagsApi;
  storage: StorageApi;
  http: HttpApi;
  story: StoryApi;
  events: EventsApi;
  /** The plugin's own ID. */
  pluginId: string;
}

/**
 * Plugin entry point interface.
 *
 * A plugin's entry.js file default-exports a function that accepts
 * the host API and returns (optionally) an object of lifecycle hooks.
 */
export interface PluginLifecycle {
  /** Called after the plugin is loaded and the host API is ready. */
  onLoad?(): void | Promise<void>;

  /** Called before the plugin is unloaded (disable or restart). */
  onUnload?(): void | Promise<void>;

  /**
   * Markdown post-processor hook (F1024).
   * Return transformed markdown or undefined to leave unchanged.
   */
  onNotePostProcess?(markdown: string, noteId: string): string | undefined | Promise<string | undefined>;

  /**
   * Search extension hook (F1027).
   * Return additional search results to merge into the search response.
   */
  onSearchExtend?(query: string): PluginSearchResult[] | Promise<PluginSearchResult[]>;

  /**
   * Pre-choice hook (F1037).
   * Called before a choice is applied in a story.
   */
  onPreChoice?(storyId: string, choiceIndex: number): void | Promise<void>;

  /**
   * Post-choice hook (F1037).
   * Called after a choice is applied in a story.
   */
  onPostChoice?(storyId: string, choiceIndex: number, result: unknown): void | Promise<void>;

  /**
   * Export format handler (F1034).
   * Called when the user requests export in a format this plugin provides.
   * Return a string representation of the story.
   */
  onExportFormat?(formatId: string, storyId: string): string | Promise<string>;
}

/** Canonical plugin entry point signature. */
export type PluginFactory = (host: PluginHost) => PluginLifecycle | Promise<PluginLifecycle>;
