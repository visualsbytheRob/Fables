/**
 * Security headers verification suite (F1269).
 *
 * Boots the real app and asserts every response carries the hardening headers
 * with their expected values — a regression guard so a refactor can't silently
 * drop a header.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

describe('security headers (F1269)', () => {
  it('sets the full hardening header set on a normal response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    const h = res.headers;
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('SAMEORIGIN');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(String(h['permissions-policy'])).toContain('geolocation=()');
    expect(String(h['permissions-policy'])).toContain('microphone=(self)');
  });

  it('ships a Content-Security-Policy with the expected directives', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  it('applies headers even on a 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/this-does-not-exist' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
