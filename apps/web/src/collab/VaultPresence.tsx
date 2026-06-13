/**
 * VaultPresence (F1133): vault-level "active now" indicator shown in the
 * app sidebar/shell.  Displays a live count of collaborators across all docs.
 *
 * This component is intentionally lightweight — it only counts peers from
 * the currently open collab session.  A full vault-level presence would
 * require a secondary awareness channel (deferred, F1133 partial).
 */
import type { CollabHandle } from './useCollab.js';

interface VaultPresenceProps {
  collab: CollabHandle;
}

export function VaultPresence({ collab }: VaultPresenceProps) {
  if (!collab.active || collab.peers.length === 0) return null;

  const active = collab.peers.filter((p) => p.active).length;
  const total = collab.peers.length;

  return (
    <div className="vault-presence" aria-live="polite" aria-label="Collaborators online">
      <span className="vault-presence__dot" aria-hidden="true" />
      {active > 0 ? (
        <span>
          {active} active{total > active ? `, ${total - active} idle` : ''}
        </span>
      ) : (
        <span>{total} idle</span>
      )}
    </div>
  );
}
