/**
 * Plugin loader (F1001–F1010).
 *
 * Discovers, validates, and registers plugins from DATA_DIR/plugins/<id>/.
 * A broken plugin never breaks boot: load failures quarantine the plugin
 * and log a warning. All state is persisted to the plugins table.
 *
 * Directory layout:
 *   DATA_DIR/plugins/<id>/manifest.json  — plugin manifest
 *   DATA_DIR/plugins/<id>/entry.js       — plugin code (loaded in worker)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { pluginManifestSchema, type PluginManifest } from '@fables/plugin-sdk';
import { APP_VERSION } from '../app.js';
import type { Db } from '../db/connection.js';
import { pluginsRepo } from '../db/repos/plugins.js';
import { semverCompat } from './semver.js';

/** Result of loading a single plugin directory. */
export interface LoadResult {
  id: string;
  ok: boolean;
  reason?: string;
}

/**
 * Load + validate a manifest.json file.
 * Returns the parsed manifest or throws with a clear reason string.
 */
export function loadManifest(pluginDir: string): PluginManifest {
  const manifestPath = path.join(pluginDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${pluginDir}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    throw new Error(`manifest.json is not valid JSON: ${(e as Error).message}`);
  }

  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`manifest.json failed validation: ${issues}`);
  }

  return parsed.data;
}

/**
 * Check semver compatibility: does `pluginRequires` fit within `appVersion`?
 * We enforce: plugin's minAppVersion must be ≤ appVersion (major must match).
 */
function checkAppVersionCompat(manifest: PluginManifest): void {
  if (!manifest.minAppVersion) return;
  const compat = semverCompat(APP_VERSION, manifest.minAppVersion);
  if (!compat.ok) {
    throw new Error(compat.reason);
  }
}

/**
 * Topologically sort plugins by their dependency declarations.
 * Returns plugins in load order. Detects cycles.
 */
export function sortByDependencies(manifests: PluginManifest[]): PluginManifest[] {
  const byId = new Map<string, PluginManifest>(manifests.map((m) => [m.id, m]));
  const sorted: PluginManifest[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`circular dependency detected involving plugin "${id}"`);
    }
    visiting.add(id);
    const manifest = byId.get(id);
    if (manifest) {
      for (const dep of manifest.dependencies) {
        visit(dep.id);
      }
      sorted.push(manifest);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const m of manifests) {
    visit(m.id);
  }

  return sorted;
}

/**
 * Validate dependency declarations: all declared deps must be installed,
 * and their versions must satisfy the declared constraint (F1006, F1007).
 */
function validateDependencies(
  manifest: PluginManifest,
  byId: Map<string, PluginManifest>,
): void {
  for (const dep of manifest.dependencies) {
    const depManifest = byId.get(dep.id);
    if (!depManifest) {
      throw new Error(`missing dependency: "${dep.id}" is required but not installed`);
    }
    const compat = semverCompat(depManifest.version, dep.version);
    if (!compat.ok) {
      throw new Error(
        `dependency "${dep.id}" version ${depManifest.version} does not satisfy required ${dep.version}: ${compat.reason}`,
      );
    }
  }
}

/**
 * Discover all plugin directories under DATA_DIR/plugins/.
 * Returns full directory paths.
 */
export function discoverPluginDirs(dataDir: string): string[] {
  const pluginsRoot = path.join(dataDir, 'plugins');
  if (!fs.existsSync(pluginsRoot)) return [];

  return fs
    .readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(pluginsRoot, d.name));
}

/**
 * Boot-time plugin discovery and registration (F1004, F1008).
 *
 * For each plugin directory:
 *  1. Load and validate manifest
 *  2. Check app version compat
 *  3. Validate dependencies (once all manifests are loaded)
 *  4. Sort by dependency order
 *  5. Upsert into the registry
 *  6. Quarantine on any failure (never breaks boot)
 */
export function discoverAndRegisterPlugins(
  db: Db,
  dataDir: string,
  log: FastifyBaseLogger,
): LoadResult[] {
  const dirs = discoverPluginDirs(dataDir);
  if (dirs.length === 0) return [];

  const repo = pluginsRepo(db);
  const results: LoadResult[] = [];

  // Phase 1: load manifests, quarantine failures individually
  const goodManifests: PluginManifest[] = [];
  for (const dir of dirs) {
    const id = path.basename(dir);
    try {
      const manifest = loadManifest(dir);
      // Validate app version compat immediately
      checkAppVersionCompat(manifest);
      goodManifests.push(manifest);
    } catch (e) {
      const reason = (e as Error).message;
      log.warn({ pluginDir: dir, reason }, 'plugin quarantined: manifest load failed');
      // Persist quarantine state if we can infer an id
      try {
        const existing = repo.get(id);
        if (existing) {
          repo.quarantine(id, reason);
        } else {
          // Can't register without a manifest, just log
        }
      } catch {
        // best effort
      }
      results.push({ id, ok: false, reason });
    }
  }

  // Phase 2: validate cross-plugin dependencies
  const byId = new Map<string, PluginManifest>(goodManifests.map((m) => [m.id, m]));
  const validManifests: PluginManifest[] = [];
  for (const manifest of goodManifests) {
    try {
      validateDependencies(manifest, byId);
      validManifests.push(manifest);
    } catch (e) {
      const reason = (e as Error).message;
      log.warn({ pluginId: manifest.id, reason }, 'plugin quarantined: dependency check failed');
      try {
        const existing = repo.get(manifest.id);
        if (existing) {
          repo.quarantine(manifest.id, reason);
        } else {
          // Upsert first, then quarantine
          repo.upsert(manifest);
          repo.quarantine(manifest.id, reason);
        }
      } catch {
        // best effort
      }
      results.push({ id: manifest.id, ok: false, reason });
    }
  }

  // Phase 3: sort by dependency order
  let sorted: PluginManifest[];
  try {
    sorted = sortByDependencies(validManifests);
  } catch (e) {
    const reason = (e as Error).message;
    log.error({ reason }, 'plugin dependency cycle detected — all affected plugins quarantined');
    for (const m of validManifests) {
      try {
        repo.upsert(m);
        repo.quarantine(m.id, `dependency cycle: ${reason}`);
      } catch {
        // best effort
      }
      results.push({ id: m.id, ok: false, reason });
    }
    return results;
  }

  // Phase 4: upsert all valid plugins
  for (const manifest of sorted) {
    try {
      repo.upsert(manifest);
      log.info({ pluginId: manifest.id, version: manifest.version }, 'plugin registered');
      results.push({ id: manifest.id, ok: true });
    } catch (e) {
      const reason = (e as Error).message;
      log.error({ pluginId: manifest.id, reason }, 'plugin registry upsert failed');
      results.push({ id: manifest.id, ok: false, reason });
    }
  }

  return results;
}
