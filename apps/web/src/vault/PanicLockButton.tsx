/**
 * PanicLockButton — floating lock button for instant vault lock (F1236, F1237).
 *
 * Renders a small "Lock" button floating above the mobile tab bar when the vault
 * is unlocked.  Clicking it calls POST /vault/lock immediately and updates the
 * local session.  Also registers a keyboard shortcut (Alt+L / Option+L).
 *
 * The indicator turns red while the lock call is in flight (F1237).
 */
import { useCallback, useEffect } from 'react';
import { Button, useToast } from '@fables/ui';
import { useVaultLock, useVaultStatus } from './useVaultStatus.js';
import { vaultStore } from './vaultStore.js';
import './vault.css';

export function PanicLockButton() {
  const { data: statusData } = useVaultStatus();
  const lock = useVaultLock();
  const { toast } = useToast();

  const triggerLock = useCallback(async () => {
    try {
      await lock.mutateAsync();
      vaultStore.markLocked();
      toast('Vault locked.');
    } catch {
      // Even if the server call fails, lock locally for safety
      vaultStore.markLocked();
      toast('Vault locked locally.');
    }
  }, [lock, toast]);

  // Keyboard shortcut: Alt+L / Option+L (F1236)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        void triggerLock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [triggerLock]);

  // Only show when vault is unlocked
  if (statusData?.status !== 'unlocked') return null;

  return (
    <Button
      variant={lock.isPending ? 'danger' : 'default'}
      className="vault-panic-btn"
      onClick={() => void triggerLock()}
      aria-label="Panic lock vault (Alt+L)"
      title="Lock vault (Alt+L)"
      disabled={lock.isPending}
      aria-busy={lock.isPending}
    >
      {lock.isPending ? 'Locking…' : 'Lock'}
    </Button>
  );
}
