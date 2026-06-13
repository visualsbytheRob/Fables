/**
 * Plugin API client — typed wrappers for the /api/v1/plugins endpoints.
 * Mirrors the server contract described in the task brief.
 *
 * F1091–F1098: added install-archive, install-url, catalog, update-check,
 * update, export, compat, and uninstall-with-purge.
 */
import { api } from '../api/client.js';
import type { PluginRecord } from './types.js';

export interface PluginAuditEntry {
  id: string;
  pluginId: string;
  event: string;
  detail: string | null;
  createdAt: string;
}

export interface PluginDetail extends PluginRecord {
  /** Recent audit events (server field: recentAudit). */
  audit: PluginAuditEntry[];
  /** Raw settings object stored for this plugin. */
  settings?: Record<string, unknown>;
  resourceUse?: {
    cpuMs?: number;
    memoryBytes?: number;
    rpcCalls?: number;
  };
}

/** Map server response (recentAudit) to client type (audit). */
function mapDetail(raw: Record<string, unknown>): PluginDetail {
  return {
    ...(raw as unknown as PluginDetail),
    audit: (raw['recentAudit'] as PluginAuditEntry[] | undefined) ?? [],
  };
}

// ─── Distribution types (F1091–F1098) ──────────────────────────────────────

export interface UpdateCheckResult {
  current: string;
  available: string;
  hasUpdate: boolean;
}

export interface UpdateResult {
  id: string;
  version: string;
}

/** Report shown before confirming an update (F1094). */
export interface CompatReport {
  addedPermissions: string[];
  breaking: string[];
}

/** An entry from the plugin catalog (F1096). */
export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  source: string;
}

export interface InstallArchiveResult {
  id: string;
  installed: boolean;
}

export interface InstallUrlResult {
  id: string;
  installed: boolean;
  /** Server sets this when the host is not on a verified allow-list. */
  untrustedHost?: boolean;
}

// ─── API surface ────────────────────────────────────────────────────────────

export const pluginsApi = {
  list: () => api.get<PluginRecord[]>('/plugins'),

  get: (id: string) =>
    api
      .get<Record<string, unknown>>(`/plugins/${id}`)
      .then(mapDetail),

  enable: (id: string) => api.post<PluginRecord>(`/plugins/${id}/enable`),

  disable: (id: string) => api.post<PluginRecord>(`/plugins/${id}/disable`),

  updateSettings: (id: string, settings: Record<string, unknown>) =>
    api.put<PluginRecord>(`/plugins/${id}/settings`, { settings }),

  revokePermission: (id: string, permission: string) =>
    api.post<PluginRecord>(`/plugins/${id}/permissions/revoke`, { permission }),

  install: (source: string) => api.post<PluginRecord>('/plugins/install', { pluginDir: source }),

  /** F1092 — install from a .fplugin archive file. */
  installArchive: async (file: File): Promise<InstallArchiveResult> => {
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await fetch('/api/v1/plugins/install-archive', {
      method: 'POST',
      body: form,
    });
    const body = (await res.json()) as { data?: InstallArchiveResult; error?: { code: string; message: string; details: Record<string, unknown> | null } };
    if (!res.ok || body.error) {
      throw new Error(body.error?.message ?? 'install-archive failed');
    }
    return body.data!;
  },

  /** F1093 — install from a URL (with optional checksum). */
  installUrl: (url: string, checksum?: string): Promise<InstallUrlResult> =>
    api.post<InstallUrlResult>('/plugins/install-url', { url, ...(checksum ? { checksum } : {}) }),

  /** F1094 — check for an update. */
  checkUpdate: (id: string): Promise<UpdateCheckResult> =>
    api.get<UpdateCheckResult>(`/plugins/${id}/update-check`),

  /** F1095 — apply an update. */
  applyUpdate: (id: string): Promise<UpdateResult> =>
    api.post<UpdateResult>(`/plugins/${id}/update`),

  /** F1096 — fetch the catalog. */
  catalog: (): Promise<CatalogEntry[]> =>
    api.get<CatalogEntry[]>('/plugins/catalog'),

  /** F1097 — export a plugin as .fplugin (raw blob download). */
  exportPlugin: async (id: string): Promise<Blob> => {
    const res = await fetch(`/api/v1/plugins/${id}/export`);
    if (!res.ok) throw new Error('export failed');
    return res.blob();
  },

  /** F1094 compat report — shown before confirming an update. */
  compat: (id: string, version: string): Promise<CompatReport> =>
    api.get<CompatReport>(`/plugins/${id}/compat?version=${encodeURIComponent(version)}`),

  /** F1098 — uninstall, optionally purging data. */
  uninstall: (id: string, purgeData = false): Promise<{ success: boolean }> =>
    purgeData
      ? api.delete<{ success: boolean }>(`/plugins/${id}?purgeData=true`)
      : api.delete<{ success: boolean }>(`/plugins/${id}`),
};
