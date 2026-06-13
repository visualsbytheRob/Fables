// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  classifyRequest,
  computeEvictions,
  isCacheable,
  isAttachmentCacheable,
  SHELL_CACHE,
  API_CACHE,
  BYTECODE_CACHE,
  ALL_CACHES,
} from './cache-strategies.js';

describe('classifyRequest', () => {
  it('returns shell for root path', () => {
    expect(classifyRequest(new URL('http://localhost/'), false)).toBe('shell');
  });

  it('returns shell for /assets/', () => {
    expect(classifyRequest(new URL('http://localhost/assets/main-abc.js'), false)).toBe('shell');
  });

  it('returns shell for icons', () => {
    expect(classifyRequest(new URL('http://localhost/icons/icon-192.png'), false)).toBe('shell');
  });

  it('returns swr-api for API GETs', () => {
    expect(classifyRequest(new URL('http://localhost/api/v1/notes'), false)).toBe('swr-api');
  });

  it('returns bytecode for story bytecode endpoint', () => {
    expect(classifyRequest(new URL('http://localhost/api/v1/stories/abc/bytecode'), false)).toBe(
      'bytecode',
    );
  });

  it('returns cache-first-font for Google Fonts', () => {
    expect(classifyRequest(new URL('https://fonts.googleapis.com/css2?family=Inter'), false)).toBe(
      'cache-first-font',
    );
  });

  it('returns bypass in dev mode', () => {
    expect(classifyRequest(new URL('http://localhost/api/v1/notes'), true)).toBe('bypass');
  });

  it('returns bypass for debug endpoints', () => {
    expect(classifyRequest(new URL('http://localhost/api/v1/debug/ping'), false)).toBe('bypass');
  });

  it('returns shell for offline.html', () => {
    expect(classifyRequest(new URL('http://localhost/offline.html'), false)).toBe('shell');
  });

  it('returns shell for webmanifest', () => {
    expect(classifyRequest(new URL('http://localhost/manifest.webmanifest'), false)).toBe('shell');
  });
});

describe('computeEvictions', () => {
  it('returns empty array when under limits', () => {
    const entries = [
      { url: 'a', timestamp: 1, size: 100 },
      { url: 'b', timestamp: 2, size: 100 },
    ];
    expect(computeEvictions(entries, 10, 10_000)).toEqual([]);
  });

  it('evicts oldest entries when over maxEntries', () => {
    const entries = [
      { url: 'old1', timestamp: 1, size: 10 },
      { url: 'old2', timestamp: 2, size: 10 },
      { url: 'new1', timestamp: 10, size: 10 },
      { url: 'new2', timestamp: 11, size: 10 },
      { url: 'new3', timestamp: 12, size: 10 },
    ];
    const evicted = computeEvictions(entries, 3, 1_000_000);
    expect(evicted).toEqual(['old1', 'old2']);
  });

  it('evicts oldest entries when over maxBytes', () => {
    const entries = [
      { url: 'big-old', timestamp: 1, size: 50_000 },
      { url: 'small-new', timestamp: 10, size: 1000 },
    ];
    const evicted = computeEvictions(entries, 100, 40_000);
    expect(evicted).toContain('big-old');
  });

  it('evicts nothing from empty list', () => {
    expect(computeEvictions([], 5, 10_000)).toEqual([]);
  });
});

describe('isCacheable', () => {
  it('returns true for 200 JSON response', () => {
    const res = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    expect(isCacheable(res)).toBe(true);
  });

  it('returns false for non-200 responses', () => {
    const res = new Response('{}', {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
    expect(isCacheable(res)).toBe(false);
  });

  it('returns false for non-JSON responses', () => {
    const res = new Response('<html/>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    expect(isCacheable(res)).toBe(false);
  });
});

describe('isAttachmentCacheable', () => {
  it('returns true for successful responses', () => {
    const res = new Response(new Uint8Array(), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
    expect(isAttachmentCacheable(res)).toBe(true);
  });

  it('returns false for error responses', () => {
    const res = new Response('', { status: 403 });
    expect(isAttachmentCacheable(res)).toBe(false);
  });
});

describe('cache name constants', () => {
  it('ALL_CACHES contains all named caches', () => {
    expect(ALL_CACHES).toContain(SHELL_CACHE);
    expect(ALL_CACHES).toContain(API_CACHE);
    expect(ALL_CACHES).toContain(BYTECODE_CACHE);
  });
});
