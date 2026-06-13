/**
 * Plugin distribution routes (F1091–F1099).
 *
 * POST   /plugins/install-archive         — install from .fplugin upload (F1091)
 * POST   /plugins/install-url             — install from URL (F1092)
 * GET    /plugins/:id/update-check        — check for newer version (F1093)
 * POST   /plugins/:id/update             — re-install from stored source (F1093)
 * GET    /plugins/:id/export             — export as .fplugin (F1094)
 * GET    /plugins/:id/compat             — compatibility report before update (F1095)
 * DELETE /plugins/:id?purgeData=true      — extended uninstall with data purge (F1096)
 * GET    /plugins/trusted-origins        — list trusted origins (F1097)
 * POST   /plugins/trusted-origins        — add trusted origin (F1097)
 * DELETE /plugins/trusted-origins/:origin — remove trusted origin (F1097)
 * GET    /plugins/catalog               — catalog of known plugins (F1098)
 * POST   /plugins/catalog/:id/install    — install from catalog (F1098)
 */

import fs from 'node:fs';
import path from 'node:path';
import multipart from '@fastify/multipart';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { notFound } from '@fables/core';
import { pluginManifestSchema } from '@fables/plugin-sdk';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { pluginsRepo } from '../db/repos/plugins.js';
import {
  packPlugin,
  unpackPlugin,
  fetchPluginArchive,
  originFromUrl,
  buildCompatReport,
  loadCatalogJson,
  sha256Hex,
  FPLUGIN_MAX_BYTES,
} from '../plugins/distribution.js';
import { loadManifest } from '../plugins/loader.js';
import type { PluginRegistry } from '../plugins/registry.js';

declare module 'fastify' {
  interface FastifyInstance {
    plugins?: PluginRegistry;
  }
}

const idParamsSchema = z.object({ id: z.string().min(1) });
const catalogIdParamsSchema = z.object({ id: z.string().min(1) });
const originParamsSchema = z.object({ origin: z.string().min(1) });

const installUrlBodySchema = z.object({
  url: z.string().url(),
  checksum: z.string().optional(),
  trust: z.boolean().optional(),
});

const compatQuerySchema = z.object({
  version: z.string().optional(),
});

const trustedOriginBodySchema = z.object({
  origin: z.string().min(1),
  note: z.string().optional(),
});

// ── Route registration ────────────────────────────────────────────────────────

registerRoute({ method: 'POST', path: '/plugins/install-archive', summary: 'Install a plugin from a .fplugin archive upload (F1091)' });
registerRoute({ method: 'POST', path: '/plugins/install-url', summary: 'Install a plugin from a URL (F1092)', body: installUrlBodySchema });
registerRoute({ method: 'GET', path: '/plugins/:id/update-check', summary: 'Check if a newer version is available (F1093)' });
registerRoute({ method: 'POST', path: '/plugins/:id/update', summary: 'Re-install plugin from stored source (F1093)' });
registerRoute({ method: 'GET', path: '/plugins/:id/export', summary: 'Export plugin as .fplugin archive (F1094)' });
registerRoute({ method: 'GET', path: '/plugins/:id/compat', summary: 'Compatibility report before update (F1095)' });
registerRoute({ method: 'GET', path: '/plugins/trusted-origins', summary: 'List trusted install origins (F1097)' });
registerRoute({ method: 'POST', path: '/plugins/trusted-origins', summary: 'Add a trusted install origin (F1097)', body: trustedOriginBodySchema });
registerRoute({ method: 'DELETE', path: '/plugins/trusted-origins/:origin', summary: 'Remove a trusted install origin (F1097)' });
registerRoute({ method: 'GET', path: '/plugins/catalog', summary: 'List the local plugin catalog (F1098)' });
registerRoute({ method: 'POST', path: '/plugins/catalog/:id/install', summary: 'Install a plugin from the catalog (F1098)' });

// ── Plugin dir helper ─────────────────────────────────────────────────────────

function pluginDir(dataDir: string, pluginId: string): string {
  return path.join(dataDir, 'plugins', pluginId);
}

// ── Main route handler ────────────────────────────────────────────────────────

export const pluginsDistributionRoutes: FastifyPluginAsync = async (app) => {
  const repo = () => pluginsRepo(app.db);

  // Register multipart for archive upload (only if not already registered by another plugin)
  if (!app.hasContentTypeParser('multipart/form-data')) {
    await app.register(multipart, { limits: { fileSize: FPLUGIN_MAX_BYTES, files: 1 } });
  }

  // ── F1091: File-based install ───────────────────────────────────────────────

  app.post('/plugins/install-archive', async (req, reply) => {
    if (!req.isMultipart()) {
      reply.status(400);
      return { error: 'expected multipart/form-data with a .fplugin file' };
    }

    const part = await req.file();
    if (!part) {
      reply.status(400);
      return { error: 'missing file field' };
    }

    const archiveBytes = new Uint8Array(await part.toBuffer());
    const archiveHash = sha256Hex(archiveBytes);

    // Unpack into a temp dir first, then move into place
    const tmpDir = path.join(app.dataDir, `.fplugin-tmp-${Date.now()}`);
    let manifest;
    try {
      manifest = unpackPlugin(archiveBytes, tmpDir);
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      reply.status(400);
      return { error: (err as Error).message };
    }

    const destDir = pluginDir(app.dataDir, manifest.id);
    // Remove existing dir if present (update scenario)
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }
    // Use copy+delete instead of rename to avoid EXDEV cross-device errors
    try {
      fs.cpSync(tmpDir, destDir, { recursive: true });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    const plugin = repo().upsert(manifest);
    repo().setSource(manifest.id, { type: 'archive', archiveHash });

    reply.status(201);
    return { data: { id: plugin.id, version: plugin.version, installed: true, archiveHash } };
  });

  // ── F1092: Install from URL ─────────────────────────────────────────────────

  app.post('/plugins/install-url', async (req, reply) => {
    const body = parseWith(installUrlBodySchema, req.body, 'body');
    const origin = originFromUrl(body.url);

    // F1097: check trusted origin
    const trusted = repo().isTrustedOrigin(origin);
    if (!trusted && body.trust !== true) {
      reply.status(403);
      return {
        error: `Origin "${origin}" is not in the trusted-origins allowlist. Re-submit with trust=true to override.`,
        origin,
        trusted: false,
      };
    }

    if (!trusted) {
      // Log the explicit trust override
      app.log.warn({ origin, url: body.url }, 'plugin installed from non-allowlisted origin (trust=true override)');
    }

    let archiveBytes: Uint8Array;
    let checksum: string;
    try {
      const result = await fetchPluginArchive(body.url, body.checksum);
      archiveBytes = result.bytes;
      checksum = result.checksum;
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }

    const tmpDir = path.join(app.dataDir, `.fplugin-tmp-${Date.now()}`);
    let manifest;
    try {
      manifest = unpackPlugin(archiveBytes, tmpDir);
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      reply.status(400);
      return { error: (err as Error).message };
    }

    const destDir = pluginDir(app.dataDir, manifest.id);
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }
    try {
      fs.cpSync(tmpDir, destDir, { recursive: true });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    const plugin = repo().upsert(manifest);
    repo().setSource(manifest.id, { type: 'url', url: body.url, archiveHash: checksum });

    reply.status(201);
    return { data: { id: plugin.id, version: plugin.version, installed: true, checksum, origin, trusted } };
  });

  // ── F1093: Update-check ─────────────────────────────────────────────────────

  app.get('/plugins/:id/update-check', async (req) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);

    const source = repo().getSource(id);
    if (!source || source.type !== 'url' || !source.url) {
      return {
        data: {
          id,
          currentVersion: plugin.version,
          updateAvailable: false,
          reason: 'plugin was not installed from a URL source',
        },
      };
    }

    // Fetch the remote archive to check its manifest version
    let remoteManifest;
    try {
      const { bytes } = await fetchPluginArchive(source.url);
      const tmpDir = path.join(app.dataDir, `.update-check-tmp-${Date.now()}`);
      try {
        remoteManifest = unpackPlugin(bytes, tmpDir);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (err) {
      return {
        data: {
          id,
          currentVersion: plugin.version,
          updateAvailable: false,
          checkError: (err as Error).message,
        },
      };
    }

    const updateAvailable = remoteManifest.version !== plugin.version;
    return {
      data: {
        id,
        currentVersion: plugin.version,
        availableVersion: remoteManifest.version,
        updateAvailable,
        sourceUrl: source.url,
      },
    };
  });

  // ── F1093: One-click update ─────────────────────────────────────────────────

  app.post('/plugins/:id/update', async (req, reply) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);

    const source = repo().getSource(id);
    if (!source) {
      reply.status(400);
      return { error: 'no stored install source — cannot auto-update' };
    }

    if (source.type !== 'url' || !source.url) {
      reply.status(400);
      return { error: `plugin source type "${source.type}" does not support auto-update` };
    }

    // Stop sandbox if running
    if (app.plugins) {
      await app.plugins.disable(id).catch(() => {});
    }

    let archiveBytes: Uint8Array;
    let checksum: string;
    try {
      const result = await fetchPluginArchive(source.url);
      archiveBytes = result.bytes;
      checksum = result.checksum;
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }

    const tmpDir = path.join(app.dataDir, `.fplugin-tmp-${Date.now()}`);
    let newManifest;
    try {
      newManifest = unpackPlugin(archiveBytes, tmpDir);
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      reply.status(400);
      return { error: (err as Error).message };
    }

    const destDir = pluginDir(app.dataDir, id);
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }
    try {
      fs.cpSync(tmpDir, destDir, { recursive: true });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    const updated = repo().upsert(newManifest);
    repo().setSource(id, { type: 'url', url: source.url, archiveHash: checksum });

    // Re-enable if it was enabled before
    if (plugin.enabled) {
      await app.plugins?.enable(id).catch(() => {});
    }

    return { data: { id, previousVersion: plugin.version, newVersion: updated.version, updated: true } };
  });

  // ── F1094: Export / backup ──────────────────────────────────────────────────

  app.get('/plugins/:id/export', async (req, reply) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);

    const dir = pluginDir(app.dataDir, id);
    if (!fs.existsSync(dir)) {
      reply.status(404);
      return { error: `plugin directory not found for "${id}" — may have been installed via inline manifest` };
    }

    const bytes = packPlugin(dir);

    void reply.header('Content-Type', 'application/octet-stream');
    void reply.header('Content-Disposition', `attachment; filename="${id}-${plugin.version}.fplugin"`);
    void reply.header('Content-Length', String(bytes.byteLength));
    return reply.send(Buffer.from(bytes));
  });

  // ── F1095: Compatibility report ─────────────────────────────────────────────

  app.get('/plugins/:id/compat', async (req, reply) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);

    const query = parseWith(compatQuerySchema, (req as { query?: unknown }).query ?? {}, 'query');

    // If a ?version= is provided, we're asked about a hypothetical new version
    // We don't actually fetch it here — we do a simulated diff using the installed manifest
    // as a stand-in (real usage would provide new manifest JSON).
    // If the source is a URL, try fetching the remote manifest for comparison.
    const source = repo().getSource(id);

    if (source?.type === 'url' && source.url && !query.version) {
      // Fetch remote to do a live compat check
      let remoteManifest;
      try {
        const { bytes } = await fetchPluginArchive(source.url);
        const tmpDir = path.join(app.dataDir, `.compat-tmp-${Date.now()}`);
        try {
          remoteManifest = unpackPlugin(bytes, tmpDir);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } catch (err) {
        reply.status(502);
        return { error: `could not fetch remote manifest for compat check: ${(err as Error).message}` };
      }

      const report = buildCompatReport(plugin.manifest, remoteManifest);
      return { data: { pluginId: id, ...report } };
    }

    // No remote source — return self-report (trivially compatible)
    const report = buildCompatReport(plugin.manifest, plugin.manifest);
    return {
      data: {
        pluginId: id,
        ...report,
        note: 'plugin was not installed from a URL source; comparing current version against itself',
      },
    };
  });

  // ── F1096: Extended uninstall ───────────────────────────────────────────────
  // Note: The base DELETE /plugins/:id is in plugins.ts; this adds purgeData support.
  // We register a separate route with a query-string variant.
  // Actually, since plugins.ts already registered DELETE /plugins/:id, we extend
  // the data purge by adding a separate /plugins/:id/purge endpoint to avoid conflict.

  app.delete('/plugins/:id/purge', async (req) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);

    // Stop sandbox if running
    if (app.plugins) {
      await app.plugins.disable(id).catch(() => {});
    }

    // Purge all plugin data, then delete the plugin record
    repo().purgePluginData(id);
    repo().deleteSource(id);
    repo().delete(id);

    // Remove plugin directory if present
    const dir = pluginDir(app.dataDir, id);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }

    return { data: { id, uninstalled: true, dataPurged: true } };
  });

  // ── F1097: Trusted-origin allowlist ────────────────────────────────────────

  app.get('/plugins/trusted-origins', async () => {
    const origins = repo().listTrustedOrigins();
    return { data: origins };
  });

  app.post('/plugins/trusted-origins', async (req, reply) => {
    const body = parseWith(trustedOriginBodySchema, req.body, 'body');
    repo().addTrustedOrigin(body.origin, body.note);
    reply.status(201);
    return { data: { origin: body.origin, added: true } };
  });

  app.delete('/plugins/trusted-origins/:origin', async (req) => {
    const { origin } = parseWith(originParamsSchema, req.params, 'params');
    repo().removeTrustedOrigin(decodeURIComponent(origin));
    return { data: { origin, removed: true } };
  });

  // ── F1098: Plugin catalog ───────────────────────────────────────────────────

  app.get('/plugins/catalog', async () => {
    // Seed from catalog.json under DATA_DIR if not already seeded
    const catalogEntries = loadCatalogJson(app.dataDir);
    const r = repo();
    for (const entry of catalogEntries) {
      const parsed = pluginManifestSchema.safeParse(entry.manifest);
      if (parsed.success) {
        const catalogEntry: {
          id: string;
          name: string;
          description: string;
          version: string;
          manifest: unknown;
          author?: string;
          sourceUrl?: string;
        } = {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          version: entry.version,
          manifest: entry.manifest,
        };
        if (entry.author !== undefined) catalogEntry.author = entry.author;
        if (entry.sourceUrl !== undefined) catalogEntry.sourceUrl = entry.sourceUrl;
        r.catalogUpsert(catalogEntry);
      }
    }

    // Also seed from example plugins if they exist (built-in examples)
    seedBuiltinExamples(app.dataDir, r);

    const catalog = r.catalogList();
    return { data: catalog };
  });

  app.post('/plugins/catalog/:id/install', async (req, reply) => {
    const { id } = parseWith(catalogIdParamsSchema, req.params, 'params');
    const r = repo();
    const entry = r.catalogGet(id);
    if (!entry) throw notFound('CatalogEntry', id);

    const parsed = pluginManifestSchema.safeParse(entry.manifest);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'catalog entry has an invalid manifest' };
    }
    const manifest = parsed.data;

    if (entry.sourceUrl) {
      // Prefer installing from the source URL (same as install-url, but trusting catalog origin)
      const origin = originFromUrl(entry.sourceUrl);
      const trusted = r.isTrustedOrigin(origin);
      if (!trusted) {
        app.log.warn({ origin, url: entry.sourceUrl }, 'catalog install from non-trusted origin');
      }

      let archiveBytes: Uint8Array;
      let checksum: string;
      try {
        const result = await fetchPluginArchive(entry.sourceUrl);
        archiveBytes = result.bytes;
        checksum = result.checksum;
      } catch (err) {
        reply.status(400);
        return { error: (err as Error).message };
      }

      const tmpDir = path.join(app.dataDir, `.fplugin-tmp-${Date.now()}`);
      let newManifest;
      try {
        newManifest = unpackPlugin(archiveBytes, tmpDir);
      } catch (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        reply.status(400);
        return { error: (err as Error).message };
      }

      const destDir = pluginDir(app.dataDir, newManifest.id);
      if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true });
      try {
        fs.cpSync(tmpDir, destDir, { recursive: true });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }

      const plugin = r.upsert(newManifest);
      r.setSource(newManifest.id, { type: 'url', url: entry.sourceUrl, archiveHash: checksum });
      reply.status(201);
      return { data: { id: plugin.id, version: plugin.version, installed: true } };
    }

    // No source URL: install from inline manifest only
    const plugin = r.upsert(manifest);
    r.setSource(manifest.id, { type: 'manifest' });
    reply.status(201);
    return { data: { id: plugin.id, version: plugin.version, installed: true } };
  });
};

// ── Built-in example catalog seeding ────────────────────────────────────────

function seedBuiltinExamples(dataDir: string, r: ReturnType<typeof pluginsRepo>): void {
  // Look for example plugins shipped with the app (under DATA_DIR/plugins/examples or
  // the server package's example-plugins directory)
  const examplesDir = path.join(dataDir, 'plugins');
  if (!fs.existsSync(examplesDir)) return;

  for (const entry of fs.readdirSync(examplesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(examplesDir, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = loadManifest(path.join(examplesDir, entry.name));
      // Only add to catalog if not already there
      if (!r.catalogGet(manifest.id)) {
        const catalogEntry: {
          id: string;
          name: string;
          description: string;
          version: string;
          manifest: unknown;
          author?: string;
          sourceUrl?: string;
        } = {
          id: manifest.id,
          name: manifest.name,
          description: manifest.description,
          version: manifest.version,
          manifest,
        };
        if (manifest.author !== undefined) catalogEntry.author = manifest.author;
        r.catalogUpsert(catalogEntry);
      }
    } catch {
      // Ignore parse errors in seeding
    }
  }
}
