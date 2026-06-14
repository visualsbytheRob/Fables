/**
 * F1265 — Memory-safe attachment / image preview helper
 *
 * Creates a blob: object URL for the given Blob and automatically revokes it
 * when the consuming component unmounts or when the blob changes, preventing
 * memory leaks in the attachment preview pipeline.
 *
 * Usage:
 *   const previewUrl = useSafeObjectUrl(blob);
 *   // previewUrl is null when blob is null/undefined
 *   return previewUrl ? <img src={previewUrl} /> : null;
 *
 * The URL is revoked via URL.revokeObjectURL in the useEffect cleanup, so the
 * browser can release the underlying ArrayBuffer from memory as soon as the
 * preview is no longer rendered.
 */
import { useEffect, useState } from 'react';

/**
 * Returns a stable blob: URL for `blob`, or `null` if blob is null/undefined.
 * Revokes the previous URL whenever `blob` changes or the component unmounts.
 */
export function useSafeObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);

    return () => {
      // Revoke promptly so the browser can free the backing memory.
      URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);

  return url;
}

/**
 * One-shot helper: creates a blob: URL, invokes `fn` with it, then revokes
 * the URL immediately after `fn` returns (or after its returned Promise settles).
 *
 * Useful for download-then-cleanup flows (e.g. triggering a save-as dialog)
 * where a long-lived hook would be overkill.
 *
 *   await withObjectUrl(blob, (url) => {
 *     const a = document.createElement('a');
 *     a.href = url;
 *     a.download = 'attachment.png';
 *     a.click();
 *   });
 */
export async function withObjectUrl<T>(
  blob: Blob,
  fn: (url: string) => T | Promise<T>,
): Promise<T> {
  const url = URL.createObjectURL(blob);
  try {
    return await fn(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
