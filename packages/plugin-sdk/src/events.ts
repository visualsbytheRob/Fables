/**
 * Typed event bus types (F1051–F1060).
 *
 * The host emits these events. Plugins subscribe via `event.subscribe` cap call.
 * Events are delivered to the worker via `onEvent` plugin_call messages.
 */

/** All event names in the typed event bus. */
export const PLUGIN_EVENTS = [
  'note.created',
  'note.updated',
  'note.deleted',
  'note.trashed',
  'note.restored',
  'note.tagged',
  'note.untagged',
  'story.compiled',
  'story.play.started',
  'story.play.choice',
  'story.play.completed',
  'story.deleted',
  'notebook.created',
  'notebook.deleted',
  'entity.created',
  'entity.updated',
  'entity.deleted',
  'search.queried',
  'plugin.enabled',
  'plugin.disabled',
  'plugin.settings.updated',
] as const;

export type PluginEventName = (typeof PLUGIN_EVENTS)[number];

/** Payload shapes for each event. */
export interface PluginEventPayloads {
  'note.created': { noteId: string; notebookId: string; title: string };
  'note.updated': { noteId: string; notebookId: string; title: string; rev: number };
  'note.deleted': { noteId: string };
  'note.trashed': { noteId: string };
  'note.restored': { noteId: string };
  'note.tagged': { noteId: string; tag: string };
  'note.untagged': { noteId: string; tag: string };
  'story.compiled': { storyId: string; success: boolean };
  'story.play.started': { storyId: string; saveId: string };
  'story.play.choice': { storyId: string; saveId: string; choiceIndex: number };
  'story.play.completed': { storyId: string; saveId: string };
  'story.deleted': { storyId: string };
  'notebook.created': { notebookId: string; name: string };
  'notebook.deleted': { notebookId: string };
  'entity.created': { entityId: string; name: string };
  'entity.updated': { entityId: string; name: string };
  'entity.deleted': { entityId: string };
  'search.queried': { query: string; resultCount: number };
  'plugin.enabled': { pluginId: string };
  'plugin.disabled': { pluginId: string };
  'plugin.settings.updated': { pluginId: string };
}

/** A typed event with its payload. */
export type PluginEvent<T extends PluginEventName = PluginEventName> = {
  event: T;
  payload: PluginEventPayloads[T];
  /** ISO timestamp when the event was emitted. */
  timestamp: string;
  /** Idempotency key (ULID) for replay protection (F1055). */
  idempotencyKey: string;
};

/** Filter chain context (F1052). */
export interface FilterChainContext {
  pluginId: string;
  priority: number;
}
