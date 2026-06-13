/**
 * Pure caching strategy logic — no ServiceWorkerGlobalScope references.
 * Factored out so unit tests can import & test this in jsdom.
 * F815–F816, F819
 */

export const CACHE_VERSION = 'v1';
export const SHELL_CACHE = `fables-shell-${CACHE_VERSION}`;
export const API_CACHE = `fables-api-${CACHE_VERSION}`;
export const ATTACHMENT_CACHE = `fables-attachments-${CACHE_VERSION}`;
export const BYTECODE_CACHE = `fables-bytecode-${CACHE_VERSION}`;

export const ALL_CACHES = [SHELL_CACHE, API_CACHE, ATTACHMENT_CACHE, BYTECODE_CACHE];

/** Files that make up the app shell (precached). */
export const SHELL_URLS = ['/', '/offline.html'];

/**
 * Decides which caching strategy to use for a given request.
 * Returns null for requests that should bypass the SW entirely.
 */
export type CacheStrategy =
  | 'shell'
  | 'swr-api'
  | 'cache-first-attachment'
  | 'cache-first-font'
  | 'bytecode'
  | 'bypass';

export function classifyRequest(url: URL, isDevMode: boolean): CacheStrategy {
  // Never intercept non-GET in the cache layer (mutations go to outbox instead)
  // NOTE: method check happens in sw.ts before calling this.

  // Dev/debug bypass
  if (isDevMode) return 'bypass';
  if (url.pathname.startsWith('/__') || url.pathname.startsWith('/api/v1/debug')) return 'bypass';

  // Static app shell & assets
  if (
    url.pathname === '/' ||
    url.pathname === '/offline.html' ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    return 'shell';
  }

  // Compiled story bytecode
  if (url.pathname.startsWith('/api/v1/stories/') && url.pathname.endsWith('/bytecode')) {
    return 'bytecode';
  }

  // API GETs → stale-while-revalidate
  if (url.pathname.startsWith('/api/')) {
    return 'swr-api';
  }

  // Attachment blobs → cache-first
  if (url.pathname.startsWith('/api/v1/attachments/')) {
    return 'cache-first-attachment';
  }

  // Google Fonts, system fonts
  if (url.hostname.includes('fonts.')) {
    return 'cache-first-font';
  }

  // Default: treat as shell (SPA catch-all)
  return 'shell';
}

/** Max entries allowed in the attachment cache (LRU eviction above this). */
export const ATTACHMENT_CACHE_MAX = 200;
/** Max total bytes in attachment cache before LRU eviction kicks in. */
export const ATTACHMENT_CACHE_MAX_BYTES = 150 * 1024 * 1024; // 150 MB

/**
 * LRU eviction: given a list of cache entry timestamps keyed by url,
 * returns the URLs that should be evicted to stay within maxEntries.
 */
export function computeEvictions(
  entries: Array<{ url: string; timestamp: number; size: number }>,
  maxEntries: number,
  maxBytes: number,
): string[] {
  // Sort oldest-first
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const toEvict: string[] = [];
  let totalBytes = sorted.reduce((s, e) => s + e.size, 0);

  while (sorted.length > maxEntries || totalBytes > maxBytes) {
    const victim = sorted.shift();
    if (!victim) break;
    toEvict.push(victim.url);
    totalBytes -= victim.size;
  }

  return toEvict;
}

/**
 * Returns true if this is an API response that should be cached.
 * We only cache successful GETs with JSON content.
 */
export function isCacheable(response: Response): boolean {
  return (
    response.ok &&
    response.status === 200 &&
    (response.headers.get('content-type')?.includes('application/json') ?? false)
  );
}

/**
 * Returns true if the attachment response should be cached.
 */
export function isAttachmentCacheable(response: Response): boolean {
  return response.ok && response.status === 200;
}
