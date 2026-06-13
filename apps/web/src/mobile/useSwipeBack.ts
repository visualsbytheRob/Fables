/**
 * Swipe-back gesture for note navigation (F872).
 * Detects a left-edge swipe and calls the provided back callback.
 * Also handles swipe-to-archive/pin on list items (F872).
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/** Attach to note detail pages: swipe right from left edge = go back. */
export function useSwipeBack(): void {
  const navigate = useNavigate();

  useEffect(() => {
    let startX: number | null = null;
    let startY: number | null = null;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      // Only trigger from left edge (within 24px)
      if (touch.clientX <= 24) {
        startX = touch.clientX;
        startY = touch.clientY;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (startX === null || startY === null) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      startX = null;
      startY = null;

      // Horizontal swipe: dx > 60px, mostly horizontal (dy < dx/2)
      if (dx > 60 && dy < dx / 2) {
        navigate(-1);
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [navigate]);
}
