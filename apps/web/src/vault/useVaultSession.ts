/**
 * React hook that wires the in-memory vaultStore to React state (F1231–F1239).
 *
 * Usage:
 *   const { sessionStatus, sessionMinutes, setSessionMinutes } = useVaultSession();
 */
import { useCallback, useEffect, useState } from 'react';
import { loadSessionMinutes, saveSessionMinutes, vaultStore } from './vaultStore.js';
import type { VaultSessionStatus } from './vaultStore.js';

export function useVaultSession() {
  const [sessionStatus, setSessionStatus] = useState<VaultSessionStatus>(vaultStore.getStatus);
  const [sessionMinutes, setSessionMinutesState] = useState(loadSessionMinutes);

  useEffect(() => {
    return vaultStore.subscribe(() => {
      setSessionStatus(vaultStore.getStatus());
    });
  }, []);

  // Reset idle timer on user activity while unlocked (F1231)
  useEffect(() => {
    if (sessionStatus !== 'unlocked') return;
    const reset = () => vaultStore.resetIdle();
    window.addEventListener('pointerdown', reset, { passive: true });
    window.addEventListener('keydown', reset, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [sessionStatus]);

  const setSessionMinutes = useCallback((minutes: number) => {
    saveSessionMinutes(minutes);
    setSessionMinutesState(minutes);
    vaultStore.resetIdle(); // re-arm with new duration
  }, []);

  return { sessionStatus, sessionMinutes, setSessionMinutes };
}
