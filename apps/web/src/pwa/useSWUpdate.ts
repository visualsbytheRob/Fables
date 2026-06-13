/**
 * Service Worker registration + update flow (F812, F818).
 * - Registers /sw.js on mount.
 * - Fires onUpdateAvailable when a new SW is waiting.
 * - `activateUpdate()` posts SKIP_WAITING and reloads.
 */
import { useCallback, useEffect, useState } from 'react';

export interface SWUpdateState {
  updateAvailable: boolean;
  activateUpdate: () => void;
}

let registration: ServiceWorkerRegistration | null = null;

export function useSWUpdate(): SWUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Dev mode: skip registration to avoid stale caches during development.
    if (import.meta.env.DEV) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        registration = reg;

        // If there's already a waiting SW (page loaded while update was waiting).
        if (reg.waiting) {
          setUpdateAvailable(true);
          return;
        }

        // Listen for new SW entering waiting state.
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateAvailable(true);
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });

    // Listen for controller change (after skipWaiting) → reload.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }, []);

  const activateUpdate = useCallback(() => {
    const waiting = registration?.waiting;
    if (waiting) {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }, []);

  return { updateAvailable, activateUpdate };
}
