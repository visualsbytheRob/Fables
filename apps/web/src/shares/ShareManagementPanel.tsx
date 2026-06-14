/**
 * F1144 — Share Management UI
 *
 * Panel listing all shares created by this device.  Each row shows:
 *   - Document title + access level
 *   - Expiry (or "Never")
 *   - A "Revoke" button that calls DELETE /shares/:id
 *   - An expandable access log (GET /shares/:id/audit)
 *
 * Server contract (consume, do not change):
 *   GET  /shares            → { data: Share[] }
 *   DELETE /shares/:id      → revokes the share
 *   GET  /shares/:id/audit  → access log
 */
import { useState } from 'react';
import { Button } from '@fables/ui';
import { useShares, useRevokeShare, useShareAudit } from '../api/hooks.js';
import type { Share } from '../api/client.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return 'Never';
  const date = new Date(expiresAt);
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function accessLevelLabel(level: string): string {
  switch (level) {
    case 'view':
      return 'View only';
    case 'comment':
      return 'Can comment';
    case 'edit':
      return 'Can edit';
    default:
      return level;
  }
}

// ─── Audit log row (lazy-loaded per share) ───────────────────────────────────

function AuditLog({ shareId }: { shareId: string }) {
  const { data, isPending, isError } = useShareAudit(shareId);

  if (isPending) return <p className="share-audit__loading">Loading access log…</p>;
  if (isError) return <p className="share-audit__error">Could not load access log.</p>;
  if (!data || data.length === 0)
    return <p className="share-audit__empty">No accesses recorded yet.</p>;

  return (
    <ul className="share-audit__list" aria-label="Access log">
      {data.map((entry) => (
        <li key={entry.id} className="share-audit__entry">
          <span className="share-audit__time">
            {new Date(entry.accessedAt).toLocaleString(undefined, {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </span>
          {entry.deviceId && <span className="share-audit__device">device: {entry.deviceId}</span>}
        </li>
      ))}
    </ul>
  );
}

// ─── Single share row ────────────────────────────────────────────────────────

function ShareRow({ share }: { share: Share }) {
  const [expanded, setExpanded] = useState(false);
  const { mutate: revoke, isPending: revoking } = useRevokeShare();

  return (
    <li className="share-row" aria-label={`Share for "${share.docTitle}"`}>
      <div className="share-row__main">
        <div className="share-row__info">
          <span className="share-row__title">{share.docTitle}</span>
          <span className="share-row__meta">
            {accessLevelLabel(share.accessLevel)} · Expires: {formatExpiry(share.expiresAt)}
          </span>
        </div>
        <div className="share-row__actions">
          <Button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={`share-audit-${share.id}`}
          >
            {expanded ? 'Hide log' : 'Access log'}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => revoke(share.id)}
            disabled={revoking}
            aria-label={`Revoke share for "${share.docTitle}"`}
          >
            {revoking ? 'Revoking…' : 'Revoke'}
          </Button>
        </div>
      </div>
      {expanded && (
        <div id={`share-audit-${share.id}`} className="share-row__audit">
          <AuditLog shareId={share.id} />
        </div>
      )}
    </li>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function ShareManagementPanel() {
  const { data, isPending, isError, refetch } = useShares();

  if (isPending) {
    return (
      <section className="share-management" aria-label="Share management">
        <p className="share-management__loading">Loading shares…</p>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="share-management" aria-label="Share management">
        <p className="share-management__error" role="alert">
          Could not load shares.{' '}
          <button type="button" onClick={() => void refetch()} className="share-management__retry">
            Try again
          </button>
        </p>
      </section>
    );
  }

  const shares = data ?? [];

  return (
    <section className="share-management" aria-label="Share management">
      <h2 className="share-management__title">Shares</h2>
      {shares.length === 0 ? (
        <p className="share-management__empty">You have not shared any documents.</p>
      ) : (
        <ul className="share-management__list" aria-label="Shared documents">
          {shares.map((share) => (
            <ShareRow key={share.id} share={share} />
          ))}
        </ul>
      )}
    </section>
  );
}
