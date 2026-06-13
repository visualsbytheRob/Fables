/**
 * Pull-to-refresh hook (F874).
 * Detects a downward touch-drag from the top of a scroll container
 * and calls the provided refresh callback.
 */
import { useEffect, useRef } from 'react';

const THRESHOLD = 60; // px drag needed to trigger

export function usePullToRefresh(onRefresh: () => void | Promise<void>): void {
  const startY = useRef<number | null>(null);
  const refreshing = useRef(false);

  useEffect(() => {
    let indicator: HTMLDivElement | null = null;

    function getIndicator(): HTMLDivElement {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'pull-refresh-indicator';
        indicator.textContent = '↓ Pull to refresh';
        document.body.appendChild(indicator);
      }
      return indicator;
    }

    function removeIndicator() {
      indicator?.remove();
      indicator = null;
    }

    const onTouchStart = (e: TouchEvent) => {
      // Only from very top
      if (window.scrollY <= 0) {
        startY.current = e.touches[0]?.clientY ?? null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null || refreshing.current) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
      if (dy > 10) {
        const el = getIndicator();
        if (dy > THRESHOLD) {
          el.textContent = '↑ Release to refresh';
          el.classList.add('pull-refresh-indicator--visible');
        } else {
          el.textContent = '↓ Pull to refresh';
          el.classList.toggle('pull-refresh-indicator--visible', dy > 20);
        }
      }
    };

    const onTouchEnd = async (e: TouchEvent) => {
      if (startY.current === null || refreshing.current) return;
      const dy = (e.changedTouches[0]?.clientY ?? 0) - startY.current;
      startY.current = null;

      if (dy > THRESHOLD) {
        refreshing.current = true;
        const el = getIndicator();
        el.textContent = '⟳ Refreshing…';
        el.classList.add('pull-refresh-indicator--loading');
        try {
          await onRefresh();
        } finally {
          refreshing.current = false;
          removeIndicator();
        }
      } else {
        removeIndicator();
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      removeIndicator();
    };
  }, [onRefresh]);
}
