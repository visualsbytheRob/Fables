/**
 * Plugin API client — typed wrappers for the /api/v1/plugins endpoints.
 * Mirrors the server contract described in the task brief.
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

export const pluginsApi = {
  list: () => api.get<{ data: PluginRecord[] }>('/plugins').then((r) => r.data),

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

  uninstall: (id: string) => api.delete<{ success: boolean }>(`/plugins/${id}`),
};
