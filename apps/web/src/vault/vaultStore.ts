/**
 * In-memory vault session store (F1231–F1239).
 *
 * Tracks:
 *   - whether the vault is unlocked in THIS tab
 *   - the session duration preference (minutes; 0 = never auto-lock)
 *   - idle auto-lock (F1231)
 *   - BroadcastChannel cross-tab coordination (F1239)
 *
 * The store is intentionally module-level so it survives React re-renders but
 * is wiped on page unload — no sensitive data persists.
 */

export type VaultSessionStatus = 'locked' | 'unlocked';

// ─── Session duration preference ────────────────────────────────────────────

const SESSION_DURATION_KEY = 'fables.vault.sessionMinutes';
const DEFAULT_SESSION_MINUTES = 30;

export function loadSessionMinutes(): number {
  try {
    const raw = localStorage.getItem(SESSION_DURATION_KEY);
    if (raw === null) return DEFAULT_SESSION_MINUTES;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SESSION_MINUTES;
  } catch {
    return DEFAULT_SESSION_MINUTES;
  }
}

export function saveSessionMinutes(minutes: number): void {
  try {
    localStorage.setItem(SESSION_DURATION_KEY, String(minutes));
  } catch {
    // ignore
  }
}

// ─── In-memory session ──────────────────────────────────────────────────────

type LockListener = () => void;

let _status: VaultSessionStatus = 'locked';
let _idleTimer: ReturnType<typeof setTimeout> | null = null;
const _listeners: Set<LockListener> = new Set();

function notify() {
  _listeners.forEach((fn) => fn());
}

// BroadcastChannel for cross-tab lock (F1239)
let _channel: BroadcastChannel | null = null;
try {
  _channel = new BroadcastChannel('fables-vault');
  _channel.onmessage = (ev) => {
    if (ev.data === 'lock') {
      _markLocked(false /* don't re-broadcast */);
    }
  };
} catch {
  // BroadcastChannel not supported (rare in old jsdom, fine in prod)
}

function _clearIdle() {
  if (_idleTimer !== null) {
    clearTimeout(_idleTimer);
    _idleTimer = null;
  }
}

/**
 * Called when we confirm from the server that the vault is now locked (or
 * when a cross-tab message arrives).
 * @param broadcast - whether to tell other tabs (prevents echo)
 */
function _markLocked(broadcast = true) {
  _status = 'locked';
  _clearIdle();
  if (broadcast) {
    try {
      _channel?.postMessage('lock');
    } catch {
      // ignore
    }
  }
  notify();
}

function _armIdleTimer() {
  _clearIdle();
  const minutes = loadSessionMinutes();
  if (minutes <= 0) return; // 0 = never auto-lock
  _idleTimer = setTimeout(
    () => {
      // Fire the lock: callers should call vaultStore.lock() which calls the
      // server and then vaultStore.markLocked().
      _listeners.forEach((fn) => fn());
    },
    minutes * 60 * 1000,
  );
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const vaultStore = {
  getStatus(): VaultSessionStatus {
    return _status;
  },

  /** Called after a successful /vault/unlock or /vault create-then-unlock. */
  markUnlocked() {
    _status = 'unlocked';
    _armIdleTimer();
    notify();
  },

  /** Called after a confirmed /vault/lock (from server or cross-tab). */
  markLocked(broadcast = true) {
    _markLocked(broadcast);
  },

  /**
   * Refresh the idle timer (call on every user interaction when unlocked).
   */
  resetIdle() {
    if (_status === 'unlocked') {
      _armIdleTimer();
    }
  },

  subscribe(fn: LockListener): () => void {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },
};

// ─── Visibility-change lock (F1232) ─────────────────────────────────────────

// Lock the local session when the PWA goes to the background.
// The server session remains unlocked so re-focus re-checks status.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && vaultStore.getStatus() === 'unlocked') {
      // Only lock locally; server lock is deferred until explicit user action or
      // the server-side session expires, to avoid hammering the network on every
      // background/foreground cycle.
      vaultStore.markLocked();
    }
  });
}
