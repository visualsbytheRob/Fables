/**
 * Conflict review panel (F844): side-by-side local vs remote with
 * pick-mine / pick-theirs / keep-both actions.
 *
 * A conflicts inbox lists pending conflicts reachable from settings or
 * a notification badge.
 */

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Check, X, GitMerge } from '@fables/ui';
import { conflictStore } from './conflictStore.js';
import type { SyncConflict, ConflictResolution } from './conflictStore.js';
import './conflict.css';

interface ConflictReviewPanelProps {
  onClose?: () => void;
}

export function ConflictReviewPanel({ onClose }: ConflictReviewPanelProps) {
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [selected, setSelected] = useState<SyncConflict | null>(null);
  const [resolving, setResolving] = useState(false);

  const refresh = useCallback(async () => {
    const pending = await conflictStore.listPending();
    setConflicts(pending);
    // If selected conflict is now resolved, clear it
    if (selected !== null && !pending.find((c) => c.id === selected.id)) {
      setSelected(pending[0] ?? null);
    }
  }, [selected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleResolve = async (conflict: SyncConflict, resolution: ConflictResolution) => {
    setResolving(true);
    try {
      await conflictStore.resolve(conflict.id, resolution);
      await refresh();
    } finally {
      setResolving(false);
    }
  };

  if (conflicts.length === 0) {
    return (
      <div className="conflict-panel conflict-panel--empty">
        <div className="conflict-panel__header">
          <GitMerge size={16} />
          <h2>Sync Conflicts</h2>
          {onClose && (
            <button className="conflict-panel__close" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="conflict-panel__empty">
          <Check size={24} style={{ color: 'var(--success, #22c55e)' }} />
          <p>No pending conflicts. All changes are in sync.</p>
        </div>
      </div>
    );
  }

  const current = selected ?? conflicts[0]!;

  return (
    <div className="conflict-panel">
      <div className="conflict-panel__header">
        <AlertTriangle size={16} style={{ color: 'var(--danger)' }} />
        <h2>Sync Conflicts ({conflicts.length})</h2>
        {onClose && (
          <button className="conflict-panel__close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Inbox list */}
      <div className="conflict-panel__body">
        <div className="conflict-inbox">
          {conflicts.map((c) => (
            <button
              key={c.id}
              className={`conflict-inbox__item${c.id === current.id ? ' active' : ''}`}
              onClick={() => setSelected(c)}
            >
              <AlertTriangle size={12} />
              <span className="conflict-inbox__entity">{c.entityId}</span>
              <span className="conflict-inbox__field">.{c.field}</span>
              <span className="conflict-inbox__time">
                {new Date(c.detectedAt).toLocaleTimeString()}
              </span>
            </button>
          ))}
        </div>

        {/* Detail view */}
        <div className="conflict-detail">
          <div className="conflict-detail__meta">
            <span className="conflict-badge">
              <AlertTriangle size={12} /> Conflict on{' '}
              <strong>{current.entityId}</strong>.{current.field}
            </span>
            <span className="conflict-detail__time">
              Detected {new Date(current.detectedAt).toLocaleString()}
            </span>
          </div>

          <div className="conflict-columns">
            <div className="conflict-col conflict-col--local">
              <div className="conflict-col__header">
                <span className="conflict-col__label">Your version</span>
                <span className="conflict-col__lamport">clock: {current.localLamport}</span>
              </div>
              <pre className="conflict-col__text">{current.localText}</pre>
            </div>

            <div className="conflict-col conflict-col--remote">
              <div className="conflict-col__header">
                <span className="conflict-col__label">Remote version</span>
                <span className="conflict-col__lamport">clock: {current.remoteLamport}</span>
              </div>
              <pre className="conflict-col__text">{current.remoteText}</pre>
            </div>
          </div>

          {current.baseText !== '' && (
            <details className="conflict-base">
              <summary>Common ancestor</summary>
              <pre className="conflict-col__text conflict-col__text--base">
                {current.baseText}
              </pre>
            </details>
          )}

          <div className="conflict-actions">
            <button
              className="conflict-btn conflict-btn--mine"
              disabled={resolving}
              onClick={() => void handleResolve(current, 'pick-mine')}
              title="Keep your version, discard remote"
            >
              Keep mine
            </button>
            <button
              className="conflict-btn conflict-btn--theirs"
              disabled={resolving}
              onClick={() => void handleResolve(current, 'pick-theirs')}
              title="Accept remote version, discard yours"
            >
              Keep theirs
            </button>
            <button
              className="conflict-btn conflict-btn--both"
              disabled={resolving}
              onClick={() => void handleResolve(current, 'keep-both')}
              title="Preserve both versions as separate conflict copies"
            >
              <GitMerge size={14} /> Keep both
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact conflict badge for the OfflineIndicator or nav. */
export function ConflictBadge({
  count,
  onClick,
}: {
  count: number;
  onClick?: () => void;
}) {
  if (count === 0) return null;
  return (
    <button
      className="conflict-badge-btn"
      onClick={onClick}
      aria-label={`${count} sync conflict${count !== 1 ? 's' : ''} — click to review`}
      title="Sync conflicts pending review"
    >
      <AlertTriangle size={12} />
      <span>{count}</span>
    </button>
  );
}
