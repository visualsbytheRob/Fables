/**
 * Plugin runtime registry (F1005, F1011).
 *
 * Manages running PluginSandbox instances. Exposes:
 *  - enable/disable without restart (F1005)
 *  - event bus fan-out (F1051)
 *  - hook priority + ordering (F1053)
 *  - failure isolation (F1056)
 */

import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { PLUGIN_EVENTS, type PluginEventName } from '@fables/plugin-sdk';
import type { Db } from '../db/connection.js';

// Static list for event-doc generation
const PLUGIN_EVENTS_LIST: readonly string[] = PLUGIN_EVENTS;

// Use crypto.randomUUID() for idempotency keys (no extra dep needed)
function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
import { pluginsRepo } from '../db/repos/plugins.js';
import { PluginSandbox } from './sandbox.js';

export interface PluginRuntimeEntry {
  pluginId: string;
  sandbox: PluginSandbox;
  priority: number; // lower = higher priority in filter chains
}

export class PluginRegistry {
  private sandboxes = new Map<string, PluginRuntimeEntry>();

  constructor(
    private readonly db: Db,
    private readonly dataDir: string,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Start sandboxes for all enabled+active plugins. */
  async startAll(): Promise<void> {
    const repo = pluginsRepo(this.db);
    const enabled = repo.listEnabled();
    for (const plugin of enabled) {
      await this.startPlugin(plugin.id, plugin.entry, plugin.permissions).catch((e) => {
        this.log.error({ pluginId: plugin.id, err: e }, 'failed to start plugin sandbox');
        repo.quarantine(plugin.id, `startup error: ${(e as Error).message}`);
      });
    }
  }

  private async startPlugin(
    pluginId: string,
    entry: string,
    permissions: string[],
    priority = 50,
  ): Promise<void> {
    const entryPath = path.join(this.dataDir, 'plugins', pluginId, entry);
    const sandbox = new PluginSandbox(
      pluginId,
      entryPath,
      permissions,
      this.db,
      this.log,
    );
    await sandbox.start();
    this.sandboxes.set(pluginId, { pluginId, sandbox, priority });
    this.log.info({ pluginId }, 'plugin sandbox started');
  }

  /** Enable a plugin and start its sandbox (F1005). */
  async enable(pluginId: string): Promise<void> {
    const repo = pluginsRepo(this.db);
    const plugin = repo.get(pluginId);
    if (!plugin) throw new Error(`plugin "${pluginId}" not found`);
    if (plugin.status === 'quarantined') {
      throw new Error(`plugin "${pluginId}" is quarantined: ${plugin.quarantineReason ?? 'unknown reason'}`);
    }

    repo.setEnabled(pluginId, true);

    // Stop existing sandbox if any
    await this.stop(pluginId);

    await this.startPlugin(pluginId, plugin.entry, plugin.permissions);
  }

  /** Disable a plugin and stop its sandbox (F1005). */
  async disable(pluginId: string): Promise<void> {
    const repo = pluginsRepo(this.db);
    repo.setEnabled(pluginId, false);
    await this.stop(pluginId);
  }

  private async stop(pluginId: string): Promise<void> {
    const entry = this.sandboxes.get(pluginId);
    if (entry) {
      await entry.sandbox.stop().catch((e) => {
        this.log.warn({ pluginId, err: e }, 'error stopping plugin sandbox');
      });
      this.sandboxes.delete(pluginId);
    }
  }

  /** Stop all running sandboxes. */
  async stopAll(): Promise<void> {
    for (const [id] of this.sandboxes) {
      await this.stop(id);
    }
  }

  /**
   * Emit an event to all subscribed plugins (F1051).
   * Failure of any one plugin is isolated (F1056).
   * Plugins are invoked in priority order (F1053).
   */
  async emit(event: PluginEventName, payload: unknown): Promise<void> {
    const idempotencyKey = newIdempotencyKey();

    const ordered = [...this.sandboxes.values()].sort((a, b) => a.priority - b.priority);

    for (const entry of ordered) {
      await entry.sandbox.deliverEvent(event, payload, idempotencyKey).catch((e) => {
        // Failure isolation: log and continue (F1056)
        this.log.warn(
          { pluginId: entry.pluginId, event, err: e },
          'plugin event delivery failed (isolated)',
        );
      });
    }
  }

  /**
   * Run a post-processor filter chain over markdown (F1024, F1052).
   * Each plugin transforms the output of the previous. Failure is isolated.
   */
  async runPostProcessor(markdown: string, noteId: string): Promise<string> {
    const ordered = [...this.sandboxes.values()].sort((a, b) => a.priority - b.priority);
    let result = markdown;
    for (const entry of ordered) {
      try {
        const out = await entry.sandbox.call({
          method: 'onNotePostProcess',
          args: [result, noteId],
        });
        if (typeof out === 'string') result = out;
      } catch (e) {
        // Failure isolation
        this.log.warn(
          { pluginId: entry.pluginId, noteId, err: e },
          'plugin post-processor failed (isolated)',
        );
      }
    }
    return result;
  }

  /**
   * Gather extended search results from all plugins (F1027).
   */
  async extendSearch(query: string): Promise<unknown[]> {
    const ordered = [...this.sandboxes.values()].sort((a, b) => a.priority - b.priority);
    const allResults: unknown[] = [];
    for (const entry of ordered) {
      try {
        const out = await entry.sandbox.call({ method: 'onSearchExtend', args: [query] });
        if (Array.isArray(out)) allResults.push(...out);
      } catch (e) {
        this.log.warn({ pluginId: entry.pluginId, err: e }, 'plugin search extension failed (isolated)');
      }
    }
    return allResults;
  }

  /**
   * Invoke a VM function registered by a plugin (F1031).
   */
  async callVmFunction(name: string, vmArgs: unknown[]): Promise<unknown> {
    for (const entry of this.sandboxes.values()) {
      try {
        const out = await entry.sandbox.call({ method: 'onVmFunction', args: [name, vmArgs] });
        if (out !== null && out !== undefined) return out;
      } catch {
        // try next plugin
      }
    }
    return null;
  }

  /**
   * Invoke a VM effect registered by a plugin (F1032).
   */
  async dispatchVmEffect(name: string, vmArgs: unknown[]): Promise<void> {
    for (const entry of this.sandboxes.values()) {
      try {
        await entry.sandbox.call({ method: 'onVmEffect', args: [name, vmArgs] });
      } catch {
        // isolated
      }
    }
  }

  /** Pre-choice hooks (F1037). */
  async runPreChoice(storyId: string, choiceIndex: number): Promise<void> {
    const ordered = [...this.sandboxes.values()].sort((a, b) => a.priority - b.priority);
    for (const entry of ordered) {
      try {
        await entry.sandbox.call({ method: 'onPreChoice', args: [storyId, choiceIndex] });
      } catch (e) {
        this.log.warn({ pluginId: entry.pluginId, err: e }, 'plugin pre-choice hook failed (isolated)');
      }
    }
  }

  /** Post-choice hooks (F1037). */
  async runPostChoice(storyId: string, choiceIndex: number, result: unknown): Promise<void> {
    const ordered = [...this.sandboxes.values()].sort((a, b) => a.priority - b.priority);
    for (const entry of ordered) {
      try {
        await entry.sandbox.call({ method: 'onPostChoice', args: [storyId, choiceIndex, result] });
      } catch (e) {
        this.log.warn({ pluginId: entry.pluginId, err: e }, 'plugin post-choice hook failed (isolated)');
      }
    }
  }

  /** Export format handler (F1034). */
  async runExportFormat(formatId: string, storyId: string): Promise<string> {
    for (const entry of this.sandboxes.values()) {
      try {
        const out = await entry.sandbox.call({ method: 'onExportFormat', args: [formatId, storyId] });
        if (typeof out === 'string' && out.length > 0) return out;
      } catch {
        // try next
      }
    }
    return '';
  }

  getSandbox(pluginId: string): PluginSandbox | undefined {
    return this.sandboxes.get(pluginId)?.sandbox;
  }

  listRunning(): string[] {
    return [...this.sandboxes.keys()];
  }

  /**
   * Generate event documentation from the registry (F1057).
   */
  generateEventDocs(): Array<{ event: string; description: string }> {
    return PLUGIN_EVENTS_LIST.map((e) => ({
      event: e,
      description: eventDescription(e),
    }));
  }
}

function eventDescription(event: string): string {
  const descriptions: Record<string, string> = {
    'note.created': 'Fired when a new note is created',
    'note.updated': 'Fired when a note is updated',
    'note.deleted': 'Fired when a note is permanently deleted',
    'note.trashed': 'Fired when a note is moved to trash',
    'note.restored': 'Fired when a note is restored from trash',
    'note.tagged': 'Fired when a tag is added to a note',
    'note.untagged': 'Fired when a tag is removed from a note',
    'story.compiled': 'Fired when a story is compiled',
    'story.play.started': 'Fired when a story playthrough begins',
    'story.play.choice': 'Fired when a player makes a story choice',
    'story.play.completed': 'Fired when a story playthrough is completed',
    'story.deleted': 'Fired when a story is deleted',
    'notebook.created': 'Fired when a notebook is created',
    'notebook.deleted': 'Fired when a notebook is deleted',
    'entity.created': 'Fired when an entity is created',
    'entity.updated': 'Fired when an entity is updated',
    'entity.deleted': 'Fired when an entity is deleted',
    'search.queried': 'Fired when the search index is queried',
    'plugin.enabled': 'Fired when a plugin is enabled',
    'plugin.disabled': 'Fired when a plugin is disabled',
    'plugin.settings.updated': 'Fired when a plugin\'s settings are changed',
  };
  return descriptions[event] ?? `Event: ${event}`;
}
