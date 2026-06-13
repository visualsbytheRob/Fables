/**
 * Plugin management routes (F1001–F1070).
 *
 * GET  /plugins                  — list all installed plugins
 * GET  /plugins/:id              — plugin detail (permissions, resource use, audit trail)
 * POST /plugins/:id/enable       — enable plugin (F1005)
 * POST /plugins/:id/disable      — disable plugin (F1005)
 * GET  /plugins/:id/settings     — get plugin settings (F1063)
 * PUT  /plugins/:id/settings     — update plugin settings (F1063)
 * POST /plugins/:id/install      — install plugin from manifest path (F1091)
 * DELETE /plugins/:id            — uninstall plugin (F1096)
 * GET  /plugins/:id/audit        — capability audit trail (F1018, F1065)
 * POST /plugins/:id/permissions/revoke  — revoke all permissions (F1064)
 * POST /plugins/:id/notebooks/grant     — grant notebook access (F1066)
 * DELETE /plugins/:id/notebooks/:notebookId — revoke notebook access (F1066)
 * GET  /plugins/:id/notebooks           — list notebook grants (F1066)
 * GET  /plugins/events/docs             — event documentation (F1057)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { notFound } from '@fables/core';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { pluginsRepo } from '../db/repos/plugins.js';
import { loadManifest } from '../plugins/loader.js';
import type { PluginRegistry } from '../plugins/registry.js';

// We access the registry via app.plugins decorator
declare module 'fastify' {
  interface FastifyInstance {
    plugins?: PluginRegistry;
  }
}

const idParamsSchema = z.object({ id: z.string().min(1) });
const notebookParamsSchema = z.object({ id: z.string().min(1), notebookId: z.string().min(1) });
const deleteQuerySchema = z.object({ purgeData: z.string().optional() });

const installBodySchema = z.object({
  /** Absolute path to a plugin directory containing manifest.json */
  pluginDir: z.string().min(1).optional(),
  /** Manifest JSON inline (for testing/API installs) */
  manifest: z.record(z.string(), z.unknown()).optional(),
});

const settingsBodySchema = z.object({
  settings: z.record(z.string(), z.unknown()),
});

const grantNotebookBodySchema = z.object({
  notebookId: z.string().min(1),
});

registerRoute({ method: 'GET', path: '/plugins', summary: 'List all installed plugins' });
registerRoute({ method: 'GET', path: '/plugins/:id', summary: 'Get plugin detail with permissions and resource use' });
registerRoute({ method: 'POST', path: '/plugins/:id/enable', summary: 'Enable a plugin' });
registerRoute({ method: 'POST', path: '/plugins/:id/disable', summary: 'Disable a plugin' });
registerRoute({ method: 'GET', path: '/plugins/:id/settings', summary: 'Get plugin settings' });
registerRoute({ method: 'PUT', path: '/plugins/:id/settings', summary: 'Update plugin settings', body: settingsBodySchema });
registerRoute({ method: 'POST', path: '/plugins/install', summary: 'Install a plugin from a directory or manifest', body: installBodySchema });
registerRoute({ method: 'DELETE', path: '/plugins/:id', summary: 'Uninstall a plugin' });
registerRoute({ method: 'GET', path: '/plugins/:id/audit', summary: 'Get plugin capability audit trail' });
registerRoute({ method: 'POST', path: '/plugins/:id/permissions/revoke', summary: 'Revoke plugin permissions (disables plugin)' });
registerRoute({ method: 'POST', path: '/plugins/:id/notebooks/grant', summary: 'Grant notebook access to plugin', body: grantNotebookBodySchema });
registerRoute({ method: 'DELETE', path: '/plugins/:id/notebooks/:notebookId', summary: 'Revoke notebook access grant' });
registerRoute({ method: 'GET', path: '/plugins/:id/notebooks', summary: 'List notebook access grants for a plugin' });
registerRoute({ method: 'GET', path: '/plugins/events/docs', summary: 'Event bus documentation' });

export const pluginsRoutes: FastifyPluginAsync = async (app) => {
  const repo = () => pluginsRepo(app.db);

  /** List all installed plugins with their status. */
  app.get('/plugins', async () => {
    const all = repo().list();
    return {
      data: all.map((p) => ({
        id: p.id,
        version: p.version,
        name: p.name,
        description: p.description,
        author: p.author,
        enabled: p.enabled,
        status: p.status,
        quarantineReason: p.quarantineReason,
        permissions: p.permissions,
        privacy: p.manifest.privacy,
        installedAt: p.installedAt,
        updatedAt: p.updatedAt,
        running: app.plugins?.listRunning().includes(p.id) ?? false,
      })),
    };
  });

  /** Plugin detail: permissions, resource use, audit summary. */
  app.get('/plugins/:id', async (req) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);

    const audit = repo().listAudit(id, 10);
    const settings = repo().getSettings(id);
    const notebooks = repo().listNotebookGrants(id);

    return {
      data: {
        id: plugin.id,
        version: plugin.version,
        name: plugin.name,
        description: plugin.description,
        author: plugin.author,
        enabled: plugin.enabled,
        status: plugin.status,
        quarantineReason: plugin.quarantineReason,
        permissions: plugin.permissions,
        privacy: plugin.manifest.privacy,
        contributes: plugin.manifest.contributes,
        vm: plugin.manifest.vm,
        blockTypes: plugin.manifest.blockTypes,
        settings,
        notebookGrants: notebooks,
        recentAudit: audit,
        running: app.plugins?.listRunning().includes(plugin.id) ?? false,
        installedAt: plugin.installedAt,
        updatedAt: plugin.updatedAt,
      },
    };
  });

  /** Enable a plugin without restart (F1005). */
  app.post('/plugins/:id/enable', async (req) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);

    if (app.plugins) {
      await app.plugins.enable(id);
    } else {
      repo().setEnabled(id, true);
    }

    // Emit plugin.enabled event
    await app.plugins?.emit('plugin.enabled', { pluginId: id });

    return { data: { id, enabled: true } };
  });

  /** Disable a plugin without restart (F1005). */
  app.post('/plugins/:id/disable', async (req) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);

    if (app.plugins) {
      await app.plugins.disable(id);
    } else {
      repo().setEnabled(id, false);
    }

    await app.plugins?.emit('plugin.disabled', { pluginId: id });

    return { data: { id, enabled: false } };
  });

  /** Get plugin settings. */
  app.get('/plugins/:id/settings', async (req) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);
    return { data: repo().getSettings(id) };
  });

  /** Update plugin settings (F1063). */
  app.put('/plugins/:id/settings', async (req) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);
    const { settings } = parseWith(settingsBodySchema, req.body, 'body');
    repo().setSettings(id, settings);

    await app.plugins?.emit('plugin.settings.updated', { pluginId: id });

    return { data: settings };
  });

  /** Install a plugin from a directory or inline manifest. */
  app.post('/plugins/install', async (req) => {
    const body = parseWith(installBodySchema, req.body, 'body');
    let manifest: ReturnType<typeof loadManifest>;

    if (body.pluginDir) {
      // Load from filesystem
      const pluginDir = body.pluginDir;
      if (!fs.existsSync(pluginDir)) {
        throw notFound('Plugin directory', pluginDir);
      }
      manifest = loadManifest(pluginDir);
      // Copy to DATA_DIR/plugins/<id>/
      const destDir = path.join(app.dataDir, 'plugins', manifest.id);
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(pluginDir)) {
        fs.copyFileSync(path.join(pluginDir, file), path.join(destDir, file));
      }
    } else if (body.manifest) {
      const { pluginManifestSchema } = await import('@fables/plugin-sdk');
      const parsed = pluginManifestSchema.safeParse(body.manifest);
      if (!parsed.success) {
        throw new Error(`invalid manifest: ${parsed.error.issues.map((i) => i.message).join(', ')}`);
      }
      manifest = parsed.data;
    } else {
      throw new Error('provide either pluginDir or manifest');
    }

    const plugin = repo().upsert(manifest);
    return { data: { id: plugin.id, installed: true } };
  });

  /** Uninstall a plugin (F1096). ?purgeData=true also removes all plugin data. */
  app.delete('/plugins/:id', async (req) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const query = parseWith(deleteQuerySchema, (req as { query?: unknown }).query ?? {}, 'query');
    const purgeData = query.purgeData === 'true' || query.purgeData === '1';

    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);

    // Stop sandbox if running
    if (app.plugins) {
      await app.plugins.disable(id).catch(() => {});
    }

    if (purgeData) {
      // Remove all plugin data before deleting the record
      repo().purgePluginData(id);
    }

    repo().delete(id);

    // Remove plugin directory if present
    const pluginDirPath = path.join(app.dataDir, 'plugins', id);
    if (fs.existsSync(pluginDirPath)) {
      fs.rmSync(pluginDirPath, { recursive: true });
    }

    return { data: { id, uninstalled: true, dataPurged: purgeData } };
  });

  /** Capability audit trail (F1018, F1065). */
  app.get('/plugins/:id/audit', async (req) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);
    const audit = repo().listAudit(id, 100);
    return { data: audit };
  });

  /**
   * Revoke all permissions: disables the plugin (F1064).
   * The plugin stays installed but is disabled and all permissions are revoked.
   */
  app.post('/plugins/:id/permissions/revoke', async (req) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);

    if (app.plugins) {
      await app.plugins.disable(id).catch(() => {});
    } else {
      repo().setEnabled(id, false);
    }

    return { data: { id, permissionsRevoked: true, disabled: true } };
  });

  /** Grant notebook access to a plugin (F1066). */
  app.post('/plugins/:id/notebooks/grant', async (req) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const { notebookId } = parseWith(grantNotebookBodySchema, req.body, 'body');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);
    repo().grantNotebook(id, notebookId);
    return { data: { pluginId: id, notebookId, granted: true } };
  });

  /** Revoke notebook access grant (F1066). */
  app.delete('/plugins/:id/notebooks/:notebookId', async (req) => {
    const { id, notebookId } = parseWith(notebookParamsSchema, req.params, 'params');
    repo().revokeNotebook(id, notebookId);
    return { data: { pluginId: id, notebookId, revoked: true } };
  });

  /** List notebook access grants for a plugin (F1066). */
  app.get('/plugins/:id/notebooks', async (req) => {
    const { id } = parseWith(idParamsSchema, req.params, 'params');
    const plugin = repo().get(id);
    if (!plugin) throw notFound('Plugin', id);
    const notebooks = repo().listNotebookGrants(id);
    return { data: notebooks };
  });

  /** Event bus documentation (F1057). */
  app.get('/plugins/events/docs', async () => {
    const docs = app.plugins?.generateEventDocs() ?? generateStaticEventDocs();
    return { data: docs };
  });
};

function generateStaticEventDocs(): Array<{ event: string; description: string }> {
  return [
    { event: 'note.created', description: 'Fired when a new note is created' },
    { event: 'note.updated', description: 'Fired when a note is updated' },
    { event: 'note.deleted', description: 'Fired when a note is permanently deleted' },
    { event: 'note.trashed', description: 'Fired when a note is moved to trash' },
    { event: 'note.restored', description: 'Fired when a note is restored from trash' },
    { event: 'note.tagged', description: 'Fired when a tag is added to a note' },
    { event: 'note.untagged', description: 'Fired when a tag is removed from a note' },
    { event: 'story.compiled', description: 'Fired when a story is compiled' },
    { event: 'story.play.started', description: 'Fired when a story playthrough begins' },
    { event: 'story.play.choice', description: 'Fired when a player makes a story choice' },
    { event: 'story.play.completed', description: 'Fired when a story playthrough is completed' },
    { event: 'story.deleted', description: 'Fired when a story is deleted' },
    { event: 'notebook.created', description: 'Fired when a notebook is created' },
    { event: 'notebook.deleted', description: 'Fired when a notebook is deleted' },
    { event: 'entity.created', description: 'Fired when an entity is created' },
    { event: 'entity.updated', description: 'Fired when an entity is updated' },
    { event: 'entity.deleted', description: 'Fired when an entity is deleted' },
    { event: 'search.queried', description: 'Fired when the search index is queried' },
    { event: 'plugin.enabled', description: 'Fired when a plugin is enabled' },
    { event: 'plugin.disabled', description: 'Fired when a plugin is disabled' },
    { event: 'plugin.settings.updated', description: "Fired when a plugin's settings are changed" },
  ];
}
