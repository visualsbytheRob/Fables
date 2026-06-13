/**
 * Offline indicator pill showing connection status + pending-op count (F851).
 * Shows only when offline or when there are pending outbox entries.
 */
import { useEffect, useState } from 'react';
import { useOnlineStatus } from './useOnlineStatus.js';
import { outboxStore } from './idb.js';
import './offline.css';

export function OfflineIndicator() {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const count = await outboxStore.count().catch(() => 0);
      if (!cancelled) setPendingCount(count);
    }
    void refresh();
    // Refresh every 3s
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Only show when offline or when there are pending writes
  if (online && pendingCount === 0) return null;

  return (
    <div
      className={`offline-pill${online ? ' offline-pill--syncing' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={
        online ? `Syncing ${pendingCount} change${pendingCount !== 1 ? 's' : ''}` : 'Offline'
      }
    >
      <span className="offline-pill__dot" aria-hidden />
      {!online ? (
        <>
          <span>Offline</span>
          {pendingCount > 0 && <span className="offline-pill__count">{pendingCount} pending</span>}
        </>
      ) : (
        <span>Syncing {pendingCount}…</span>
      )}
    </div>
  );
}
