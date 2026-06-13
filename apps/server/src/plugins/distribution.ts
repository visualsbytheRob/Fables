/**
 * Plugin distribution utilities (F1091–F1099).
 *
 * Handles:
 *  - .fplugin archive packing/unpacking (fflate zip)
 *  - URL fetch + checksum verification
 *  - Path-traversal guard on archive entry paths
 *  - Trusted-origin checks
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync, type Zippable } from 'fflate';
import { pluginManifestSchema, type PluginManifest } from '@fables/plugin-sdk';

export const FPLUGIN_EXTENSION = '.fplugin';
export const FPLUGIN_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Path-traversal guard ──────────────────────────────────────────────────────

/**
 * Validates that an archive entry path cannot escape the target directory.
 * Throws if the path is suspicious.
 */
export function assertSafeEntryPath(entryPath: string): void {
  // Reject absolute paths
  if (path.isAbsolute(entryPath)) {
    throw new Error(`path-traversal: absolute path in archive entry "${entryPath}"`);
  }
  // Reject .. components
  const normalized = path.normalize(entryPath);
  if (normalized.startsWith('..') || normalized.includes('/..') || normalized.includes('\\..')) {
    throw new Error(`path-traversal: ".." in archive entry "${entryPath}"`);
  }
  // Reject null bytes
  if (entryPath.includes('\0')) {
    throw new Error(`path-traversal: null byte in archive entry "${entryPath}"`);
  }
}

// ── Archive format (.fplugin) ─────────────────────────────────────────────────

/**
 * Pack a plugin directory into a .fplugin archive (zip containing manifest.json + entry.js + assets).
 */
export function packPlugin(pluginDir: string): Uint8Array {
  const files: Zippable = {};
  const entries = fs.readdirSync(pluginDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(pluginDir, entry.name)));
      files[entry.name] = [bytes, { level: 0 }];
    }
  }
  return zipSync(files);
}

/**
 * Unpack a .fplugin archive into a target directory.
 * Validates manifest, guards against path-traversal, and returns the parsed manifest.
 */
export function unpackPlugin(archiveBytes: Uint8Array, destDir: string): PluginManifest {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archiveBytes);
  } catch (err) {
    throw new Error(`failed to unzip .fplugin archive: ${(err as Error).message}`);
  }

  // Require manifest.json
  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) {
    throw new Error('.fplugin archive is missing manifest.json');
  }

  // Parse + validate manifest
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(Buffer.from(manifestBytes).toString('utf-8'));
  } catch {
    throw new Error('manifest.json in archive is not valid JSON');
  }

  const parsed = pluginManifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`manifest.json failed validation: ${issues}`);
  }
  const manifest = parsed.data;

  // Guard all entry paths
  for (const entryPath of Object.keys(files)) {
    assertSafeEntryPath(entryPath);
  }

  // Write files to destDir
  fs.mkdirSync(destDir, { recursive: true });
  for (const [entryPath, bytes] of Object.entries(files)) {
    const destPath = path.join(destDir, entryPath);
    // Double-check resolved path is still under destDir
    const resolved = path.resolve(destPath);
    const resolvedDest = path.resolve(destDir);
    if (!resolved.startsWith(resolvedDest + path.sep) && resolved !== resolvedDest) {
      throw new Error(`path-traversal: resolved path "${resolved}" escapes destination "${resolvedDest}"`);
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, bytes);
  }

  return manifest;
}

// ── Checksum helpers ──────────────────────────────────────────────────────────

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ── URL fetch ─────────────────────────────────────────────────────────────────

/**
 * Fetches a .fplugin archive from a URL.
 * Optionally verifies SHA-256 checksum.
 *
 * @param url      The URL to fetch (must be https:// or http://localhost)
 * @param expected Optional expected SHA-256 hex checksum
 */
export async function fetchPluginArchive(
  url: string,
  expectedChecksum?: string,
): Promise<{ bytes: Uint8Array; checksum: string }> {
  const parsed = new URL(url); // throws on invalid URL
  const allowed =
    parsed.protocol === 'https:' ||
    (parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'));
  if (!allowed) {
    throw new Error(`insecure URL protocol "${parsed.protocol}" — only https:// is allowed (http://localhost for dev)`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/octet-stream, */*' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(`failed to fetch plugin archive from "${url}": ${(err as Error).message}`);
  }

  if (!response.ok) {
    throw new Error(`failed to fetch plugin archive: HTTP ${response.status} from "${url}"`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  if (bytes.byteLength > FPLUGIN_MAX_BYTES) {
    throw new Error(`plugin archive too large: ${bytes.byteLength} bytes (max ${FPLUGIN_MAX_BYTES})`);
  }

  const checksum = sha256Hex(bytes);
  if (expectedChecksum && checksum !== expectedChecksum) {
    throw new Error(
      `plugin archive checksum mismatch: expected ${expectedChecksum}, got ${checksum}`,
    );
  }

  return { bytes, checksum };
}

// ── Origin extraction ─────────────────────────────────────────────────────────

/** Extract the origin (scheme + host) from a URL string. */
export function originFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return url;
  }
}

// ── Manifest compatibility report (F1095) ────────────────────────────────────

export interface CompatReport {
  compatible: boolean;
  addedPermissions: string[];
  removedPermissions: string[];
  versionChange: { from: string; to: string };
  warnings: string[];
}

/**
 * Compare installed manifest vs new manifest and produce a compatibility report.
 */
export function buildCompatReport(
  installed: PluginManifest,
  incoming: PluginManifest,
): CompatReport {
  const installedPerms = new Set(installed.permissions);
  const incomingPerms = new Set(incoming.permissions);

  const addedPermissions = [...incomingPerms].filter((p) => !installedPerms.has(p));
  const removedPermissions = [...installedPerms].filter((p) => !incomingPerms.has(p));

  const warnings: string[] = [];
  if (addedPermissions.length > 0) {
    warnings.push(`New permissions requested: ${addedPermissions.join(', ')}`);
  }

  // API / entry change check
  if (installed.entry !== incoming.entry) {
    warnings.push(`Entry point changed: ${installed.entry} → ${incoming.entry}`);
  }

  // minAppVersion bump
  if (installed.minAppVersion !== incoming.minAppVersion && incoming.minAppVersion) {
    warnings.push(`Minimum app version requirement changed: ${installed.minAppVersion ?? 'none'} → ${incoming.minAppVersion}`);
  }

  return {
    compatible: addedPermissions.length === 0,
    addedPermissions,
    removedPermissions,
    versionChange: { from: installed.version, to: incoming.version },
    warnings,
  };
}

// ── Catalog seed from example plugins ────────────────────────────────────────

/**
 * Seed the catalog from a catalog.json file under DATA_DIR, if it exists.
 */
export function loadCatalogJson(dataDir: string): Array<{
  id: string;
  name: string;
  description: string;
  author?: string;
  version: string;
  manifest: unknown;
  sourceUrl?: string;
}> {
  const catalogPath = path.join(dataDir, 'catalog.json');
  if (!fs.existsSync(catalogPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw as Array<{ id: string; name: string; description: string; version: string; manifest: unknown }>;
  } catch {
    return [];
  }
}
