/**
 * F1263 — ClipboardCopyButton
 *
 * A button that copies `text` to the clipboard and shows a "Copied — will
 * clear in 30 s" badge while the auto-clear timer is running.  When the timer
 * fires the badge disappears.
 */
import { useEffect, useState } from 'react';
import { Button } from '@fables/ui';
import { copyWithAutoClear, type CopyResult } from './clipboard.js';

interface Props {
  text: string;
  /** Label shown before copying. Default: "Copy" */
  label?: string;
  /** Seconds until the clipboard is cleared. Default: 30 */
  clearAfterSeconds?: number;
  className?: string;
}

export function ClipboardCopyButton({
  text,
  label = 'Copy',
  clearAfterSeconds = 30,
  className,
}: Props) {
  const [pending, setPending] = useState<CopyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Clean up timer on unmount so we don't try to update state after unmount.
  useEffect(() => {
    return () => {
      pending?.cancel();
    };
  }, [pending]);

  async function handleCopy() {
    setError(null);
    // Cancel any existing timer before starting a new one.
    pending?.cancel();
    try {
      const result = await copyWithAutoClear(text, {
        clearAfterMs: clearAfterSeconds * 1_000,
        onCleared: () => setPending(null),
      });
      setPending(result);
    } catch {
      setError('Failed to copy — check clipboard permissions.');
    }
  }

  return (
    <span className={`clipboard-copy-btn${className ? ` ${className}` : ''}`}>
      <Button
        type="button"
        onClick={() => void handleCopy()}
        aria-label={pending ? `${label} (will clear in ${clearAfterSeconds}s)` : label}
      >
        {pending ? 'Copied' : label}
      </Button>
      {pending && (
        <span
          className="clipboard-copy-btn__badge"
          role="status"
          aria-live="polite"
          aria-label={`Clipboard will be cleared in ${clearAfterSeconds} seconds`}
        >
          Copied — will clear in {clearAfterSeconds}s
        </span>
      )}
      {error && (
        <span className="clipboard-copy-btn__error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
