/**
 * CollabToggle (F1119): opt-in collaboration control shown in the note/story
 * editor header.  Shows connection state + a connect/disconnect button.
 *
 * Connection states:
 *   off         — collab disabled (default)
 *   connecting  — WS handshake in progress
 *   connected   — live, syncing with peers
 *   disconnected/error — was connected, now offline; still editing locally
 */

export interface CollabToggleHandle {
  active: boolean;
  connState: string;
  enable: () => void;
  disable: () => void;
}

interface CollabToggleProps {
  collab: CollabToggleHandle;
}

const STATE_LABEL: Record<string, string> = {
  off: 'Collaborate',
  connecting: 'Connecting…',
  connected: 'Live',
  disconnected: 'Offline',
  error: 'Error',
};

const STATE_CLASS: Record<string, string> = {
  off: '',
  connecting: 'collab-toggle--connecting',
  connected: 'collab-toggle--live',
  disconnected: 'collab-toggle--offline',
  error: 'collab-toggle--error',
};

export function CollabToggle({ collab }: CollabToggleProps) {
  const { active, connState, enable, disable } = collab;
  const label = STATE_LABEL[connState] ?? 'Collaborate';
  const cls = STATE_CLASS[connState] ?? '';

  return (
    <button
      type="button"
      className={`collab-toggle ${cls}`}
      aria-pressed={active}
      title={active ? 'Disconnect collaboration' : 'Start collaborating on this note'}
      onClick={() => (active ? disable() : enable())}
    >
      <span className="collab-toggle__dot" aria-hidden="true" />
      {label}
    </button>
  );
}
