/**
 * PresenceAvatars (F1132): avatar stack showing who's currently viewing/editing
 * the open document.  Derives state from the awareness object via the
 * peers list.
 *
 * Features:
 *   F1132 — avatar stack on open documents
 *   F1134 — tooltip with name
 *   F1135 — idle/away peers shown as semi-transparent
 */

export interface PresencePeer {
  clientId: number;
  user: { name: string; color: string };
  active: boolean;
}

interface PresenceAvatarsProps {
  peers: PresencePeer[];
  /** Max avatars shown before "+N" overflow. */
  maxVisible?: number;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#111' : '#fff';
}

export function PresenceAvatars({ peers, maxVisible = 5 }: PresenceAvatarsProps) {
  if (peers.length === 0) return null;

  const visible = peers.slice(0, maxVisible);
  const overflow = peers.length - visible.length;

  return (
    <div
      className="presence-avatars"
      aria-label={`${peers.length} collaborator${peers.length === 1 ? '' : 's'} online`}
    >
      {visible.map((peer) => (
        <span
          key={peer.clientId}
          className={`presence-avatar${peer.active ? '' : ' presence-avatar--idle'}`}
          style={{
            background: peer.user.color,
            color: contrastColor(peer.user.color),
          }}
          title={`${peer.user.name}${peer.active ? '' : ' (idle)'}`}
          aria-label={peer.user.name}
        >
          {initials(peer.user.name)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="presence-avatar presence-avatar--overflow" title={`${overflow} more`}>
          +{overflow}
        </span>
      )}
    </div>
  );
}
