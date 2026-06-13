/**
 * Offline settings panel (F830): storage quota, persistence, IDB wipe/repair.
 * Embedded in the app settings or standalone at /settings/offline.
 */
import { useEffect, useState } from 'react';
import { checkStorageQuota, requestStoragePersistence, wipeDb, type StorageQuota } from './idb.js';
import { hydrateAll } from './hydration.js';

export function OfflineSettingsPanel() {
  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function refreshQuota() {
    const q = await checkStorageQuota();
    setQuota(q);
  }

  useEffect(() => {
    void refreshQuota();
  }, []);

  async function handleRequestPersist() {
    const granted = await requestStoragePersistence();
    setMessage(granted ? 'Persistent storage granted.' : 'Persistent storage denied by browser.');
    await refreshQuota();
  }

  async function handleWipe() {
    if (!window.confirm('Wipe all local data? This cannot be undone.')) return;
    setLoading(true);
    try {
      await wipeDb();
      setMessage('Local database wiped. Re-hydrating from server…');
      await hydrateAll();
      setMessage('Re-hydration complete.');
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
      await refreshQuota();
    }
  }

  async function handleRehydrate() {
    setLoading(true);
    try {
      await hydrateAll();
      setMessage('Re-hydration complete.');
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
      await refreshQuota();
    }
  }

  return (
    <div className="offline-settings">
      <h3>Offline Storage</h3>

      {quota && (
        <div className="quota-display">
          <div className="quota-bar">
            <div
              className="quota-bar__fill"
              style={{ width: `${Math.min(quota.percentUsed, 100)}%` }}
            />
          </div>
          <p>
            {formatBytes(quota.usage)} used of {formatBytes(quota.quota)} quota (
            {quota.percentUsed.toFixed(1)}%)
          </p>
          <p>
            Persistent storage:{' '}
            {quota.isPersistent ? (
              <span className="badge badge--green">Granted</span>
            ) : (
              <span className="badge badge--yellow">Not persistent</span>
            )}
          </p>
        </div>
      )}

      {message && <p className="offline-settings__msg">{message}</p>}

      <div className="offline-settings__actions">
        {quota && !quota.isPersistent && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void handleRequestPersist()}
            disabled={loading}
          >
            Request Persistent Storage
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => void handleRehydrate()}
          disabled={loading}
        >
          {loading ? 'Syncing…' : 'Re-sync from server'}
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => void handleWipe()}
          disabled={loading}
        >
          Wipe local database
        </button>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
