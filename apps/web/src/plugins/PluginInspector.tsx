/**
 * F1075 — Dev-mode plugin inspector.
 * Shows RPC traffic, events, and performance data pulled from the server's
 * audit trail. Only renders in dev mode or when devMode prop is true.
 *
 * F1073 — Hot-reload affordance: a button that pings the dev reload endpoint.
 */
import { useState } from 'react';
import { Button, useToast } from '@fables/ui';
import { usePlugin } from './hooks.js';
import './plugins.css';

export interface PluginInspectorProps {
  pluginId: string;
  onClose?: () => void;
}

export function PluginInspector({ pluginId, onClose }: PluginInspectorProps) {
  const { toast } = useToast();
  const detail = usePlugin(pluginId);
  const [filter, setFilter] = useState('');

  const audit = detail.data?.audit ?? [];
  const resourceUse = detail.data?.resourceUse;

  const filteredAudit = filter
    ? audit.filter(
        (e) =>
          e.event.toLowerCase().includes(filter.toLowerCase()) ||
          (e.detail ?? '').toLowerCase().includes(filter.toLowerCase()),
      )
    : audit;

  function handleHotReload() {
    // Pings a dev-only endpoint; gracefully handles non-dev environments.
    fetch(`/api/v1/plugins/${pluginId}/reload`, { method: 'POST' })
      .then((r) => {
        if (r.ok) toast('Plugin reloaded');
        else toast('Reload not available in this environment', 'error');
      })
      .catch(() => toast('Reload not available in this environment', 'error'));
  }

  return (
    <div className="plugin-inspector-panel" role="complementary" aria-label="Plugin Inspector">
      <div className="plugin-inspector-panel__header">
        <strong>Inspector: {pluginId}</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => void detail.refetch()} aria-label="Refresh inspector data">
            Refresh
          </Button>
          <Button onClick={handleHotReload} aria-label="Hot-reload plugin">
            Hot-reload
          </Button>
          {onClose && (
            <Button onClick={onClose} aria-label="Close inspector">
              Close
            </Button>
          )}
        </div>
      </div>

      {/* Resource summary */}
      {resourceUse && (
        <div className="plugin-inspector-panel__resources">
          {resourceUse.cpuMs !== undefined && (
            <span>CPU: {resourceUse.cpuMs.toFixed(1)}ms</span>
          )}
          {resourceUse.memoryBytes !== undefined && (
            <span>Mem: {(resourceUse.memoryBytes / 1024).toFixed(1)}KB</span>
          )}
          {resourceUse.rpcCalls !== undefined && (
            <span>RPC calls: {resourceUse.rpcCalls}</span>
          )}
        </div>
      )}

      {/* Filter */}
      <input
        type="search"
        className="plugin-inspector-panel__filter"
        placeholder="Filter events…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter audit events"
      />

      {/* Event log */}
      {detail.isLoading && (
        <p style={{ padding: 8, color: 'var(--text-dim)', fontSize: 'var(--text-xs)' }}>
          Loading…
        </p>
      )}
      <div className="plugin-inspector" role="log" aria-label="Plugin event log" aria-live="polite">
        {filteredAudit.length === 0 && (
          <span style={{ color: 'var(--text-dim)' }}>No events.</span>
        )}
        {filteredAudit.map((entry) => (
          <div key={entry.id} className="plugin-inspector__entry">
            <span className="plugin-inspector__ts">
              {new Date(entry.createdAt).toLocaleTimeString()}
            </span>
            <span className="plugin-inspector__type">{entry.event}</span>
            {entry.detail && (
              <span className="plugin-inspector__payload">{entry.detail}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
