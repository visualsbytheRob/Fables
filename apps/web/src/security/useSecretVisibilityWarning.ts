/**
 * F1264 — Screenshot / recording warnings on secret notes (where detectable).
 *
 * TRUE screenshot or screen-recording detection is NOT possible on the web.
 * There is no browser API that reliably tells you when a screenshot is taken or
 * when a screen-recording tool is capturing your window.
 *
 * What IS detectable with the Page Visibility API:
 *   - The user switches away (document becomes hidden) and comes back while a
 *     secret note is open.  On some mobile OSes (iOS, Android) this happens
 *     when the screenshot preview is shown, but it also happens for any normal
 *     app-switch — we cannot tell the difference.
 *
 * We therefore show a DISCREET, non-blocking notice when the page re-appears
 * after being hidden, so the user is aware that their screen may have been
 * observed.  We do NOT alert on every visibility change to avoid noise.
 *
 * This hook is intentionally opt-in: components that render "secret" content
 * (vault-decrypted notes, recovery codes, etc.) should call it.
 */
import { useEffect, useRef } from 'react';

export interface SecretVisibilityWarningOptions {
  /**
   * Called each time the page becomes visible again after being hidden while
   * the secret was shown.  Use this to render a discreet warning banner.
   */
  onReappear: () => void;
  /**
   * If `false` the hook is disabled (e.g. when the note is not actually
   * marked as secret, or the feature is toggled off).  Default: `true`.
   */
  enabled?: boolean;
}

/**
 * Attach a Page Visibility listener to a "secret" view and call `onReappear`
 * when the page returns from a hidden state.
 *
 * NOTE: This does NOT detect screenshots.  It only detects visibility changes
 * that happen to coincide with possible screen captures on some platforms.
 * Honest disclosure is critical — do not market this as screenshot detection.
 */
export function useSecretVisibilityWarning({
  onReappear,
  enabled = true,
}: SecretVisibilityWarningOptions): void {
  // Track whether we saw a "hidden" event so we only fire when re-appearing.
  const wasHidden = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        wasHidden.current = true;
      } else if (document.visibilityState === 'visible' && wasHidden.current) {
        wasHidden.current = false;
        onReappear();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, onReappear]);
}
