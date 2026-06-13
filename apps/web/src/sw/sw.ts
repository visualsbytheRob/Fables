/**
 * Fables Service Worker — F811–F820
 *
 * Strategy:
 *  - App shell + static assets: cache-first (precached on install)
 *  - API GETs: stale-while-revalidate (serve cached, refresh in background)
 *  - Attachments / fonts: cache-first with LRU size cap
 *  - Story bytecode: cache-first (offline play)
 *  - Non-GET mutations: pass-through (offline mutations → outbox in IndexedDB)
 *  - Offline fallback: /offline.html when network + cache both fail
 *
 * Built as a separate Vite entry (sw entry in vite.config.ts).
 */

/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

// BackgroundSync API type (not yet in TS lib)
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
  readonly lastChance: boolean;
}

import {
  ALL_CACHES,
  ATTACHMENT_CACHE,
  ATTACHMENT_CACHE_MAX,
  ATTACHMENT_CACHE_MAX_BYTES,
  API_CACHE,
  BYTECODE_CACHE,
  SHELL_CACHE,
  SHELL_URLS,
  classifyRequest,
  computeEvictions,
  isAttachmentCacheable,
  isCacheable,
} from './cache-strategies.js';

const IS_DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

// ──────────────────────────────── INSTALL ────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Precache shell URLs; failures are non-fatal (offline install possible).
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)));
      // Skip waiting so the new SW activates immediately.
      await self.skipWaiting();
    })(),
  );
});

// ──────────────────────────────── ACTIVATE ───────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete old cache versions (cache versioning + cleanup, F817).
      const keys = await caches.keys();
      const stale = keys.filter((k) => !ALL_CACHES.includes(k));
      await Promise.all(stale.map((k) => caches.delete(k)));
      // Take control of all pages immediately.
      await self.clients.claim();
    })(),
  );
});

// ──────────────────────────────── FETCH ──────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin or known CDN requests.
  if (url.origin !== self.location.origin && !url.hostname.includes('fonts.')) return;

  // Non-GET: pass through (mutations go to outbox).
  if (req.method !== 'GET') return;

  const strategy = classifyRequest(url, IS_DEV);
  if (strategy === 'bypass') return;

  event.respondWith(handleFetch(req, url, strategy));
});

async function handleFetch(
  req: Request,
  url: URL,
  strategy: ReturnType<typeof classifyRequest>,
): Promise<Response> {
  switch (strategy) {
    case 'shell':
      return cacheFirst(req, SHELL_CACHE, true);

    case 'swr-api':
      return staleWhileRevalidate(req, API_CACHE);

    case 'cache-first-attachment':
      return cacheFirst(req, ATTACHMENT_CACHE, false, true);

    case 'cache-first-font':
      return cacheFirst(req, SHELL_CACHE, false);

    case 'bytecode':
      return cacheFirst(req, BYTECODE_CACHE, false);

    default:
      return fetch(req).catch(() => offlineFallback(url));
  }
}

// ──────────────────────────────── STRATEGIES ─────────────────────────────────

async function cacheFirst(
  req: Request,
  cacheName: string,
  withOfflineFallback: boolean,
  isAttachment = false,
): Promise<Response> {
  const cached = await caches.match(req, { ignoreVary: true });
  if (cached) return cached;

  try {
    const response = await fetch(req);
    if (isAttachment ? isAttachmentCacheable(response) : response.ok) {
      const cache = await caches.open(cacheName);
      void cache.put(req, response.clone());
      if (isAttachment) void maybEvictAttachments();
    }
    return response;
  } catch {
    if (withOfflineFallback) return offlineFallback(new URL(req.url));
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(req: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreVary: true });

  const networkPromise = fetch(req)
    .then((res) => {
      if (isCacheable(res)) void cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) {
    // Serve stale immediately; refresh in background.
    void networkPromise;
    return cached;
  }

  // No cache — wait for network.
  const net = await networkPromise;
  return (
    net ??
    new Response(JSON.stringify({ error: { code: 'OFFLINE', message: 'Offline' } }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })
  );
}

async function offlineFallback(url: URL): Promise<Response> {
  // For navigation requests (HTML), return the offline page.
  const offline = await caches.match('/offline.html');
  if (offline && (url.pathname === '/' || !url.pathname.includes('.'))) return offline;
  return new Response('Offline', { status: 503 });
}

// ──────────────────────────────── LRU EVICTION ───────────────────────────────

async function maybEvictAttachments(): Promise<void> {
  const cache = await caches.open(ATTACHMENT_CACHE);
  const keys = await cache.keys();

  const entries: Array<{ url: string; timestamp: number; size: number }> = [];
  for (const req of keys) {
    const res = await cache.match(req);
    if (!res) continue;
    const size = parseInt(res.headers.get('content-length') ?? '0', 10);
    const dateStr = res.headers.get('date');
    const timestamp = dateStr ? new Date(dateStr).getTime() : 0;
    entries.push({ url: req.url, timestamp, size });
  }

  const toEvict = computeEvictions(entries, ATTACHMENT_CACHE_MAX, ATTACHMENT_CACHE_MAX_BYTES);
  for (const url of toEvict) {
    await cache.delete(url);
  }
}

// ──────────────────────────────── MESSAGES ───────────────────────────────────
self.addEventListener('message', (event) => {
  const { type } = (event.data ?? {}) as { type?: string };

  if (type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }

  if (type === 'CACHE_BYTECODE') {
    const { url, body } = event.data as { url: string; body: string };
    void (async () => {
      const cache = await caches.open(BYTECODE_CACHE);
      await cache.put(url, new Response(body, { headers: { 'content-type': 'application/json' } }));
    })();
  }
});

// ──────────────────────────────── BACKGROUND SYNC ────────────────────────────
self.addEventListener('sync', (event) => {
  const syncEvent = event as SyncEvent;
  if (syncEvent.tag === 'fables-outbox') {
    // The sync engine (packages/sync) will listen on the BroadcastChannel
    // and drain the outbox when online. Here we just notify the app.
    syncEvent.waitUntil(notifyClientsSync());
  }
});

async function notifyClientsSync(): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'BACKGROUND_SYNC_TRIGGER' });
  }
}

export {};
