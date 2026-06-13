/**
 * Offline indicator pill showing connection status + pending-op count (F851).
 * Upgraded (F863) to also reflect SyncEngine health state and conflict count (F844).
 *
 * Shows only when offline, when there are pending outbox entries, or when there
 * are unresolved conflicts.
 */
import { useOnlineStatus } from './useOnlineStatus.js';
import { AlertTriangle } from '@fables/ui';
import './offline.css';
import './conflict.css';

interface OfflineIndicatorProps {
  /** Pending op count from useSync() */
  pendingCount?: number;
  /** Conflict count from useSync() */
  conflictCount?: number;
  /** Whether a sync is in progress */
  isSyncing?: boolean;
  /** Called when conflict badge is clicked */
  onConflictClick?: () => void;
}

export function OfflineIndicator({
  pendingCount = 0,
  conflictCount = 0,
  isSyncing = false,
  onConflictClick,
}: OfflineIndicatorProps) {
  const online = useOnlineStatus();

  // Only show when offline, syncing, pending writes, or conflicts
  if (online && pendingCount === 0 && !isSyncing && conflictCount === 0) return null;

  return (
    <div
      className={`offline-pill${online ? (isSyncing ? ' offline-pill--syncing' : '') : ''}`}
      role="status"
      aria-live="polite"
      aria-label={
        !online
          ? 'Offline'
          : isSyncing
            ? `Syncing ${pendingCount} change${pendingCount !== 1 ? 's' : ''}`
            : pendingCount > 0
              ? `${pendingCount} pending change${pendingCount !== 1 ? 's' : ''}`
              : 'Sync up to date'
      }
    >
      <span className="offline-pill__dot" aria-hidden />
      {!online ? (
        <>
          <span>Offline</span>
          {pendingCount > 0 && (
            <span className="offline-pill__count">{pendingCount} pending</span>
          )}
        </>
      ) : isSyncing ? (
        <span>Syncing {pendingCount > 0 ? `${pendingCount}` : ''}…</span>
      ) : pendingCount > 0 ? (
        <span>{pendingCount} pending</span>
      ) : null}

      {conflictCount > 0 && (
        <button
          className="conflict-badge-btn"
          onClick={onConflictClick}
          aria-label={`${conflictCount} sync conflict${conflictCount !== 1 ? 's' : ''} — click to review`}
        >
          <AlertTriangle size={12} />
          <span>{conflictCount}</span>
        </button>
      )}
    </div>
  );
}
