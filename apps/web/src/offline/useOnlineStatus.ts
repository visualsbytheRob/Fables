/**
 * Online/offline status hook (F851).
 * Subscribes to navigator.onLine + online/offline events.
 * Also does a periodic lightweight server health ping to detect captive portals.
 */
import { useEffect, useRef, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  const probeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Lightweight probe every 30s to verify actual connectivity
    probeTimer.current = setInterval(async () => {
      try {
        const res = await fetch('/api/v1/health', {
          method: 'HEAD',
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
        setOnline(res.ok);
      } catch {
        setOnline(false);
      }
    }, 30_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (probeTimer.current) clearInterval(probeTimer.current);
    };
  }, []);

  return online;
}
