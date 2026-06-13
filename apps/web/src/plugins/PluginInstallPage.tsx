/**
 * F1091 — Install-from-file (.fplugin upload)
 * F1092 — Install-from-URL (with optional checksum + trusted-source confirmation)
 * F1096 — Plugin catalog browser with one-click install
 *
 * Route: /plugins/install
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Dialog, useToast } from '@fables/ui';
import {
  useInstallArchive,
  useInstallUrl,
  usePluginCatalog,
  useInstallFromCatalog,
} from './hooks.js';
import type { CatalogEntry } from './client.js';
import './plugins.css';

// ─── File install tab (F1091) ────────────────────────────────────────────────

function InstallFileTab() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const installArchive = useInstallArchive();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setSelectedFile(f);
  }

  function handleInstall() {
    if (!selectedFile) return;
    installArchive.mutate(selectedFile, {
      onSuccess: (result) => {
        toast(`Plugin installed (id: ${result.id})`);
        navigate('/plugins');
      },
      onError: (err) => toast(`Install failed: ${err.message}`, 'error'),
    });
  }

  return (
    <div className="plugin-install-tab">
      <p className="plugin-install-tab__help">
        Select a <code>.fplugin</code> archive file from your device to install locally.
      </p>
      <div className="plugin-install-file-row">
        <input
          ref={fileInputRef}
          type="file"
          accept=".fplugin"
          className="plugin-install-file-input"
          aria-label="Select .fplugin file"
          onChange={handleFileChange}
          data-testid="file-input"
        />
        {selectedFile && (
          <p className="plugin-install-file-name" aria-live="polite">
            Selected: <strong>{selectedFile.name}</strong>
          </p>
        )}
      </div>
      <Button
        variant="primary"
        disabled={!selectedFile || installArchive.isPending}
        onClick={handleInstall}
        aria-label="Install selected plugin file"
      >
        {installArchive.isPending ? 'Installing…' : 'Install from file'}
      </Button>
    </div>
  );
}

// ─── URL install tab (F1092) ─────────────────────────────────────────────────

function InstallUrlTab() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const installUrl = useInstallUrl();

  const [url, setUrl] = useState('');
  const [checksum, setChecksum] = useState('');
  const [showUntrustedConfirm, setShowUntrustedConfirm] = useState(false);

  function handleInstall() {
    if (!url.trim()) return;
    const trimmedChecksum = checksum.trim();
    installUrl.mutate(
      { url: url.trim(), ...(trimmedChecksum ? { checksum: trimmedChecksum } : {}) },
      {
        onSuccess: (result) => {
          if (result.untrustedHost) {
            // Server flagged the host — ask user to confirm
            setShowUntrustedConfirm(true);
          } else {
            toast(`Plugin installed (id: ${result.id})`);
            navigate('/plugins');
          }
        },
        onError: (err) => toast(`Install failed: ${err.message}`, 'error'),
      },
    );
  }

  function handleUntrustedConfirm() {
    // Already installed (server returned id); just navigate.
    setShowUntrustedConfirm(false);
    toast('Plugin installed from untrusted source');
    navigate('/plugins');
  }

  return (
    <div className="plugin-install-tab">
      <p className="plugin-install-tab__help">
        Enter a direct URL to a <code>.fplugin</code> file. Optionally provide a SHA-256 checksum for
        integrity verification.
      </p>
      <div className="plugin-install-url-fields">
        <Input
          type="url"
          placeholder="https://example.com/my-plugin.fplugin"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Plugin URL"
        />
        <Input
          type="text"
          placeholder="SHA-256 checksum (optional)"
          value={checksum}
          onChange={(e) => setChecksum(e.target.value)}
          aria-label="Checksum (optional)"
        />
      </div>
      <Button
        variant="primary"
        disabled={!url.trim() || installUrl.isPending}
        onClick={handleInstall}
        aria-label="Install plugin from URL"
      >
        {installUrl.isPending ? 'Installing…' : 'Install from URL'}
      </Button>

      {/* Untrusted host confirmation dialog */}
      <Dialog open={showUntrustedConfirm} onClose={() => setShowUntrustedConfirm(false)}>
        <div className="plugin-untrusted-dialog">
          <h2 className="plugin-untrusted-dialog__title">Untrusted source</h2>
          <p className="plugin-untrusted-dialog__body">
            The host <strong>{(() => { try { return new URL(url).hostname; } catch { return url; } })()}</strong> is
            not on the trusted plugin registry. Installing from unverified sources may be unsafe.
          </p>
          <div className="plugin-untrusted-dialog__actions">
            <Button variant="primary" onClick={handleUntrustedConfirm}>
              I understand, continue
            </Button>
            <Button onClick={() => setShowUntrustedConfirm(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ─── Catalog tab (F1096) ─────────────────────────────────────────────────────

function CatalogTab() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: catalog = [], isLoading, isError } = usePluginCatalog();
  const installFromCatalog = useInstallFromCatalog();
  const [installingId, setInstallingId] = useState<string | null>(null);

  function handleInstall(entry: CatalogEntry) {
    setInstallingId(entry.id);
    installFromCatalog.mutate(entry.source, {
      onSuccess: () => {
        toast(`Installed ${entry.name}`);
        setInstallingId(null);
        navigate('/plugins');
      },
      onError: (err) => {
        toast(`Install failed: ${err.message}`, 'error');
        setInstallingId(null);
      },
    });
  }

  if (isLoading) {
    return <p className="plugins-page__loading">Loading catalog…</p>;
  }
  if (isError) {
    return (
      <p className="plugins-page__error" role="alert">
        Could not load the plugin catalog. Try again later.
      </p>
    );
  }
  if (catalog.length === 0) {
    return <p className="plugins-page__empty">No plugins in the catalog yet.</p>;
  }

  return (
    <ul className="plugin-catalog-list" role="list" aria-label="Plugin catalog">
      {catalog.map((entry) => (
        <li key={entry.id} className="plugin-catalog-item">
          <div className="plugin-catalog-item__body">
            <span className="plugin-catalog-item__name">{entry.name}</span>
            <span className="plugin-catalog-item__version">v{entry.version}</span>
            {entry.description && (
              <p className="plugin-catalog-item__desc">{entry.description}</p>
            )}
          </div>
          <Button
            variant="primary"
            disabled={installingId === entry.id}
            onClick={() => handleInstall(entry)}
            aria-label={`Install ${entry.name} from catalog`}
          >
            {installingId === entry.id ? 'Installing…' : 'Install'}
          </Button>
        </li>
      ))}
    </ul>
  );
}

// ─── Main install page ────────────────────────────────────────────────────────

type InstallTab = 'file' | 'url' | 'catalog';

export function PluginInstallPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<InstallTab>('file');

  return (
    <div className="plugins-page" role="main" aria-label="Install Plugin">
      <header className="plugins-page__header">
        <button
          type="button"
          className="plugin-detail__back"
          onClick={() => navigate('/plugins')}
        >
          ← Plugins
        </button>
        <h1 className="plugins-page__title">Install Plugin</h1>
        <p className="plugins-page__subtitle">
          Install a plugin from a local file, a URL, or the curated catalog.
        </p>
      </header>

      {/* Tab bar */}
      <div className="plugin-install-tabs" role="tablist" aria-label="Install method">
        {(['file', 'url', 'catalog'] as InstallTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`plugin-install-tab-btn${activeTab === tab ? ' plugin-install-tab-btn--active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'file' ? 'From file' : tab === 'url' ? 'From URL' : 'Catalog'}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div role="tabpanel" aria-label={`Install ${activeTab}`}>
        {activeTab === 'file' && <InstallFileTab />}
        {activeTab === 'url' && <InstallUrlTab />}
        {activeTab === 'catalog' && <CatalogTab />}
      </div>
    </div>
  );
}
