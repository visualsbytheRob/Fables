/**
 * TanStack Query hooks for the plugin management API.
 * F1091–F1098: added distribution hooks.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { pluginsApi } from './client.js';
import type { PluginRecord } from './types.js';

// Query keys
export const pluginKeys = {
  all: ['plugins'] as const,
  detail: (id: string) => ['plugins', id] as const,
};

export function usePlugins() {
  return useQuery({
    queryKey: pluginKeys.all,
    queryFn: () => pluginsApi.list(),
  });
}

export function usePlugin(id: string) {
  return useQuery({
    queryKey: pluginKeys.detail(id),
    queryFn: () => pluginsApi.get(id),
  });
}

export function useEnablePlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pluginsApi.enable(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pluginKeys.all });
    },
  });
}

export function useDisablePlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pluginsApi.disable(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pluginKeys.all });
    },
  });
}

export function useUpdatePluginSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, settings }: { id: string; settings: Record<string, unknown> }) =>
      pluginsApi.updateSettings(id, settings),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: pluginKeys.detail(vars.id) });
    },
  });
}

export function useRevokePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, permission }: { id: string; permission: string }) =>
      pluginsApi.revokePermission(id, permission),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: pluginKeys.detail(vars.id) });
      void qc.invalidateQueries({ queryKey: pluginKeys.all });
    },
  });
}

export function useInstallPlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (source: string) => pluginsApi.install(source),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pluginKeys.all });
    },
  });
}

export function useUninstallPlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pluginsApi.uninstall(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pluginKeys.all });
    },
  });
}

/** Return plugins grouped by enabled/disabled. */
export function usePluginsByStatus() {
  const { data: plugins = [], ...rest } = usePlugins();
  const enabled = plugins.filter((p: PluginRecord) => p.enabled);
  const disabled = plugins.filter((p: PluginRecord) => !p.enabled);
  return { enabled, disabled, all: plugins, ...rest };
}

// ─── F1091–F1098 distribution hooks ────────────────────────────────────────

export function useInstallArchive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => pluginsApi.installArchive(file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pluginKeys.all });
    },
  });
}

export function useInstallUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ url, checksum }: { url: string; checksum?: string }) =>
      pluginsApi.installUrl(url, checksum),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pluginKeys.all });
    },
  });
}

export function useUpdateCheck(id: string) {
  return useQuery({
    queryKey: ['plugins', id, 'update-check'] as const,
    queryFn: () => pluginsApi.checkUpdate(id),
    // Poll every 5 minutes in background; stale immediately so re-focus refreshes.
    staleTime: 0,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useApplyUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pluginsApi.applyUpdate(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: pluginKeys.all });
      void qc.invalidateQueries({ queryKey: pluginKeys.detail(id) });
    },
  });
}

export function usePluginCatalog() {
  return useQuery({
    queryKey: ['plugins', 'catalog'] as const,
    queryFn: () => pluginsApi.catalog(),
    staleTime: 60 * 1000,
  });
}

export function useInstallFromCatalog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => pluginsApi.installUrl(url),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pluginKeys.all });
    },
  });
}

export function useExportPlugin() {
  return useMutation({
    mutationFn: (id: string) => pluginsApi.exportPlugin(id),
  });
}

export function useCompatReport() {
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: string }) =>
      pluginsApi.compat(id, version),
  });
}

export function useUninstallPluginWithPurge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, purgeData }: { id: string; purgeData: boolean }) =>
      pluginsApi.uninstall(id, purgeData),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pluginKeys.all });
    },
  });
}
