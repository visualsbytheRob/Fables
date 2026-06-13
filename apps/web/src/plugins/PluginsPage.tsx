/**
 * F1063 — Plugin management UI: list with enable/disable, per-plugin settings.
 * F1068 — Bulk plugin management.
 * F1061 — Permission review before enabling.
 *
 * Route: /plugins
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, useToast } from '@fables/ui';
import {
  usePluginsByStatus,
  useEnablePlugin,
  useDisablePlugin,
  useInstallPlugin,
  useUninstallPlugin,
} from './hooks.js';
import { PermissionReviewDialog } from './PermissionReview.js';
import type { PluginRecord } from './types.js';
import './plugins.css';

interface PluginRowProps {
  plugin: PluginRecord;
  onEnable: (plugin: PluginRecord) => void;
  onDisable: (id: string) => void;
  onUninstall: (id: string) => void;
  onViewDetail: (id: string) => void;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
}

function PluginRow({
  plugin,
  onEnable,
  onDisable,
  onUninstall,
  onViewDetail,
  selected,
  onSelect,
}: PluginRowProps) {
  return (
    <li className={`plugin-row${plugin.enabled ? ' plugin-row--enabled' : ''}`}>
      <input
        type="checkbox"
        className="plugin-row__checkbox"
        checked={selected}
        onChange={(e) => onSelect(plugin.id, e.target.checked)}
        aria-label={`Select ${plugin.name}`}
      />
      <div className="plugin-row__body">
        <div className="plugin-row__name-row">
          {plugin.iconUrl && (
            <img src={plugin.iconUrl} alt="" className="plugin-row__icon" aria-hidden="true" />
          )}
          <button
            type="button"
            className="plugin-row__name"
            onClick={() => onViewDetail(plugin.id)}
          >
            {plugin.name}
          </button>
          <span className="plugin-row__version">v{plugin.version}</span>
          <span
            className={`plugin-row__status plugin-row__status--${plugin.status}`}
            aria-label={`Status: ${plugin.status}`}
          >
            {plugin.status}
          </span>
        </div>
        {plugin.description && (
          <p className="plugin-row__description">{plugin.description}</p>
        )}
        {plugin.permissions.length > 0 && (
          <p className="plugin-row__perms">
            Permissions: {plugin.permissions.join(', ')}
          </p>
        )}
      </div>
      <div className="plugin-row__actions">
        {plugin.enabled ? (
          <Button onClick={() => onDisable(plugin.id)} aria-label={`Disable ${plugin.name}`}>
            Disable
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => onEnable(plugin)}
            aria-label={`Enable ${plugin.name}`}
          >
            Enable
          </Button>
        )}
        <Button onClick={() => onViewDetail(plugin.id)} aria-label={`Details for ${plugin.name}`}>
          Details
        </Button>
        <Button
          onClick={() => onUninstall(plugin.id)}
          aria-label={`Uninstall ${plugin.name}`}
        >
          Uninstall
        </Button>
      </div>
    </li>
  );
}

export function PluginsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const { all: plugins, isLoading, isError } = usePluginsByStatus();
  const enablePlugin = useEnablePlugin();
  const disablePlugin = useDisablePlugin();
  const installPlugin = useInstallPlugin();
  const uninstallPlugin = useUninstallPlugin();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [installSource, setInstallSource] = useState('');
  const [reviewPlugin, setReviewPlugin] = useState<PluginRecord | null>(null);

  const filtered = plugins.filter(
    (p: PluginRecord) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  function handleSelect(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleSelectAll(checked: boolean) {
    setSelected(checked ? new Set(filtered.map((p: PluginRecord) => p.id)) : new Set());
  }

  function handleBulkEnable() {
    for (const id of selected) {
      const plugin = plugins.find((p: PluginRecord) => p.id === id);
      if (plugin && !plugin.enabled) {
        setReviewPlugin(plugin);
        return; // review one at a time
      }
    }
  }

  function handleBulkDisable() {
    for (const id of selected) {
      const plugin = plugins.find((p: PluginRecord) => p.id === id);
      if (plugin?.enabled) {
        disablePlugin.mutate(id, {
          onError: (err) => toast(`Failed to disable ${plugin.name}: ${err.message}`, 'error'),
        });
      }
    }
    toast(`Disabled ${selected.size} plugin(s)`);
    setSelected(new Set());
  }

  function handleEnable(plugin: PluginRecord) {
    if (plugin.permissions.length > 0) {
      setReviewPlugin(plugin);
    } else {
      enablePlugin.mutate(plugin.id, {
        onSuccess: () => toast(`${plugin.name} enabled`),
        onError: (err) => toast(`Failed: ${err.message}`, 'error'),
      });
    }
  }

  function handleReviewAllow() {
    if (!reviewPlugin) return;
    enablePlugin.mutate(reviewPlugin.id, {
      onSuccess: () => toast(`${reviewPlugin.name} enabled`),
      onError: (err) => toast(`Failed: ${err.message}`, 'error'),
    });
    setReviewPlugin(null);
  }

  return (
    <div className="plugins-page" role="main" aria-label="Plugin Management">
      <header className="plugins-page__header">
        <h1 className="plugins-page__title">Plugins</h1>
        <p className="plugins-page__subtitle">
          Manage extensions that add features to Fables.
        </p>
      </header>

      {/* Install section */}
      <section className="plugins-page__install" aria-labelledby="plugins-install-heading">
        <h2 id="plugins-install-heading" className="plugins-page__section-title">
          Install plugin
        </h2>
        <div className="plugins-page__install-row">
          <Input
            type="text"
            placeholder="Plugin source URL or ID"
            value={installSource}
            onChange={(e) => setInstallSource(e.target.value)}
            aria-label="Plugin source"
          />
          <Button
            variant="primary"
            disabled={!installSource.trim() || installPlugin.isPending}
            onClick={() => {
              installPlugin.mutate(installSource.trim(), {
                onSuccess: (p) => {
                  toast(`Installed ${p.name}`);
                  setInstallSource('');
                },
                onError: (err) => toast(`Install failed: ${err.message}`, 'error'),
              });
            }}
          >
            Install
          </Button>
          <Button onClick={() => navigate('/plugins/gallery')}>Browse gallery</Button>
        </div>
      </section>

      {/* Search & bulk actions */}
      <div className="plugins-page__toolbar">
        <Input
          type="search"
          placeholder="Search plugins…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search plugins"
          style={{ maxWidth: 280 }}
        />
        {selected.size > 0 && (
          <div className="plugins-page__bulk" role="toolbar" aria-label="Bulk actions">
            <span>{selected.size} selected</span>
            <Button onClick={handleBulkEnable}>Enable selected</Button>
            <Button onClick={handleBulkDisable}>Disable selected</Button>
            <Button onClick={() => setSelected(new Set())}>Clear selection</Button>
          </div>
        )}
      </div>

      {/* Plugin list */}
      {isLoading && <p className="plugins-page__loading">Loading plugins…</p>}
      {isError && (
        <p className="plugins-page__error" role="alert">
          Could not load plugins. The server plugin endpoint may not be available yet.
        </p>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <p className="plugins-page__empty">
          {search ? 'No plugins match your search.' : 'No plugins installed.'}
        </p>
      )}

      {!isLoading && filtered.length > 0 && (
        <>
          <div className="plugins-page__select-all">
            <label className="plugins-page__select-all-label">
              <input
                type="checkbox"
                checked={selected.size === filtered.length && filtered.length > 0}
                onChange={(e) => handleSelectAll(e.target.checked)}
                aria-label="Select all plugins"
              />
              Select all ({filtered.length})
            </label>
          </div>
          <ul className="plugin-list" role="list" aria-label="Installed plugins">
            {filtered.map((plugin: PluginRecord) => (
              <PluginRow
                key={plugin.id}
                plugin={plugin}
                onEnable={handleEnable}
                onDisable={(id) => {
                  disablePlugin.mutate(id, {
                    onSuccess: () => toast(`Plugin disabled`),
                    onError: (err) => toast(`Failed: ${err.message}`, 'error'),
                  });
                }}
                onUninstall={(id) => {
                  uninstallPlugin.mutate(id, {
                    onSuccess: () => toast('Plugin uninstalled'),
                    onError: (err) => toast(`Failed: ${err.message}`, 'error'),
                  });
                }}
                onViewDetail={(id) => navigate(`/plugins/${id}`)}
                selected={selected.has(plugin.id)}
                onSelect={handleSelect}
              />
            ))}
          </ul>
        </>
      )}

      {/* Permission review dialog (F1061) */}
      {reviewPlugin && (
        <PermissionReviewDialog
          plugin={reviewPlugin}
          open={!!reviewPlugin}
          onAllow={handleReviewAllow}
          onDeny={() => setReviewPlugin(null)}
        />
      )}
    </div>
  );
}
