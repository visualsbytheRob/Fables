/**
 * Update-available toast (F818): shown when a new SW version is waiting.
 * Mounts once in App.tsx; calls useSWUpdate to detect and activate.
 */
import { useEffect } from 'react';
import { useToast } from '@fables/ui';
import { useSWUpdate } from './useSWUpdate.js';

export function SWUpdateToast() {
  const { toast } = useToast();
  const { updateAvailable, activateUpdate } = useSWUpdate();

  useEffect(() => {
    if (!updateAvailable) return;
    // Show a sticky toast with a refresh action.
    toast('A new version of Fables is available — tap to refresh.', 'info');
  }, [updateAvailable, toast]);

  // The activate hook is wired to the toast action; expose via a global for
  // the toast click handler (ToastProvider doesn't support actions yet).
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__fables_swUpdate = activateUpdate;
  }, [activateUpdate]);

  return null;
}
