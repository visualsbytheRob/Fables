/**
 * Plugin service — top-level coordinator (F1004, F1005).
 *
 * Wires loader + registry together. Called from jobs.ts on boot.
 * The Fastify app decorates itself with `app.plugins` (a PluginRegistry).
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/connection.js';
import { discoverAndRegisterPlugins } from './loader.js';
import { PluginRegistry } from './registry.js';

export type { PluginRegistry };

export async function startPluginService(
  db: Db,
  dataDir: string,
  log: FastifyBaseLogger,
): Promise<PluginRegistry> {
  // 1. Discover and register manifests
  const results = discoverAndRegisterPlugins(db, dataDir, log);
  const loaded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  if (loaded + failed > 0) {
    log.info({ loaded, failed }, 'plugin discovery complete');
  }

  // 2. Start sandboxes for enabled plugins
  const registry = new PluginRegistry(db, dataDir, log);
  await registry.startAll();

  return registry;
}
