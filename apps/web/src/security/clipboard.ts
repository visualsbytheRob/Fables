/**
 * F1263 — Clipboard hygiene utility.
 *
 * Copies text to the clipboard and schedules an automatic clear after a
 * configurable timeout (default 30 s).  Returns a cancel function so the
 * caller can abort the scheduled clear (e.g. when the component unmounts).
 *
 * IMPORTANT: `navigator.clipboard.writeText('')` is the clearing mechanism.
 * Browsers allow this on HTTPS origins (including localhost). In non-secure
 * contexts the Clipboard API may be absent; we fall back to a no-op so the
 * feature degrades gracefully.
 */

export interface CopyOptions {
  /** Milliseconds to wait before clearing the clipboard. Default: 30 000 */
  clearAfterMs?: number;
  /** Called when the auto-clear fires (so the UI can update its badge). */
  onCleared?: () => void;
}

export interface CopyResult {
  /** Abort the scheduled clear (e.g. component unmounted before timeout). */
  cancel: () => void;
}

/**
 * Copy `text` to the system clipboard and schedule an auto-clear.
 *
 * @returns A promise that resolves once the text is copied, carrying a
 *          `cancel` function to abort the pending clear.
 */
export async function copyWithAutoClear(
  text: string,
  options: CopyOptions = {},
): Promise<CopyResult> {
  const { clearAfterMs = 30_000, onCleared } = options;

  if (!navigator.clipboard) {
    // Clipboard API unavailable (non-HTTPS or restricted context). Silently
    // succeed so callers don't need to branch on environment.
    return { cancel: () => {} };
  }

  await navigator.clipboard.writeText(text);

  let timerId: ReturnType<typeof setTimeout> | null = setTimeout(async () => {
    timerId = null;
    try {
      await navigator.clipboard.writeText('');
    } catch {
      // Ignore: clipboard may have been replaced by the OS or another app.
    }
    onCleared?.();
  }, clearAfterMs);

  return {
    cancel: () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    },
  };
}

/**
 * Convenience: check whether a clear timer is "active" purely from the outside
 * so components can display the "will clear in Xs" affordance.
 *
 * Usage: keep the `CopyResult` in component state; show the badge while it
 * exists, clear it when `onCleared` fires or on cancel.
 */
export function isClearPending(result: CopyResult | null): boolean {
  return result !== null;
}
