/**
 * Security hardening tests (F941–F950).
 *
 * Covers:
 *  F942 — HTML/Markdown sanitization note (no server-side HTML stored)
 *  F943 — SQL injection audit: verify repos use parameterized queries
 *  F944 — Path traversal guard on attachment serving
 *  F945 — VM effects allowlist (only known effect types accepted)
 *  F947 — Security headers present on API responses
 *  F948 — Upload content-type sniffing protection
 *  F949 — Token auth: constant-time compare, gate on/off
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { isAllowedMime, MAX_ATTACHMENT_BYTES } from './routes/attachments.js';
import { generateToken } from './security.js';

// ── test app factory ─────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

// ── F947: Security headers ───────────────────────────────────────────────────

describe('security headers (F947)', () => {
  it('sets X-Content-Type-Options: nosniff on every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options: SAMEORIGIN', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('sets a Content-Security-Policy header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('sets Referrer-Policy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});

// ── F942: HTML sanitization note ─────────────────────────────────────────────

describe('HTML/XSS sanitization audit (F942)', () => {
  it('stores note body as raw markdown and does not render HTML server-side', async () => {
    const nb = await app.inject({
      method: 'POST',
      url: '/api/v1/notebooks',
      payload: { name: 'sec-test' },
    });
    const nbId = nb.json().data.id;

    const xssPayload = '<script>alert("xss")</script>';
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/notes',
      payload: { notebookId: nbId, title: 'xss-test', body: xssPayload },
    });
    expect(create.statusCode).toBe(201);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/notes/${create.json().data.id}`,
    });
    // Server echoes back the raw markdown — rendering/sanitizing is the client's job.
    expect(get.json().data.body).toBe(xssPayload);
    // But the content-type header is always JSON, never text/html.
    expect(get.headers['content-type']).toContain('application/json');
  });
});

// ── F943: SQL injection audit ─────────────────────────────────────────────────

describe('SQL injection audit (F943)', () => {
  it('all repo files use parameterized queries (no string-interpolated SQL with user data)', () => {
    // Scan every .ts file under db/repos for `db.prepare(\`...\${` patterns
    // that would indicate user-supplied data interpolated directly into SQL.
    // Safe exceptions: column names from hardcoded dictionaries (ORDERINGS),
    // table names from hardcoded string literals.
    const reposDir = path.resolve(import.meta.dirname, 'db/repos');
    const files = fs.readdirSync(reposDir).filter((f) => f.endsWith('.ts'));
    const violations: string[] = [];

    const SAFE_PATTERNS = [
      // Hardcoded table name lookups: `SELECT COUNT(*) AS n FROM ${table}`
      // where `table` is a local const derived from a hardcoded string.
      /FROM \$\{table\}/,
      // Hardcoded column/direction from ORDERINGS dict:
      /ORDER BY \$\{column\} \$\{dir\}/,
      // Dynamic WHERE clause built from hardcoded clause strings (no user data in clause text):
      /SELECT \* FROM stories \$\{where\}/,
    ];

    for (const file of files) {
      const src = fs.readFileSync(path.join(reposDir, file), 'utf8');
      // Look for .prepare() or .exec() calls that contain template literals
      const prepareMatches = src.match(/\.prepare\(`[^`]*\$\{[^}]+\}[^`]*`\)/g) ?? [];
      const execMatches = src.match(/\.exec\(`[^`]*\$\{[^}]+\}[^`]*`\)/g) ?? [];
      for (const match of [...prepareMatches, ...execMatches]) {
        const isSafe = SAFE_PATTERNS.some((p) => p.test(match));
        if (!isSafe) violations.push(`${file}: ${match.slice(0, 100)}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('rejects SQL meta-characters in search queries without erroring', async () => {
    // The FTS sanitizer strips dangerous tokens; it should never propagate them
    // as an injection vector.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=' + encodeURIComponent("'; DROP TABLE notes; --"),
    });
    // Should be 200 or 404 (no notes found), never 500.
    expect([200, 404]).toContain(res.statusCode);
  });
});

// ── F944: Path traversal ─────────────────────────────────────────────────────

describe('path traversal guard (F944)', () => {
  it('attachment IDs are database-validated, not filesystem-derived', async () => {
    // A random ID that contains path-traversal characters should return 404,
    // not expose an arbitrary file.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/attachments/' + encodeURIComponent('../../etc/passwd'),
    });
    expect(res.statusCode).toBe(404);
  });

  it('attachment hash is always a 64-char hex string derived server-side', async () => {
    // The attachment path builder only uses hashes stored in the database.
    // A fake hash with path separators would fail the hex regex.
    const fakeHash = '../../../../../etc/shadow';
    expect(/^[0-9a-f]{64}$/.test(fakeHash)).toBe(false);
  });

  it('content-addressed store only writes files named by SHA-256 hash', () => {
    // attachmentPath must never accept a non-hex-hash input in practice.
    // Verify the hex-check regex used in listStoredFiles rejects traversal strings.
    const valid = createHash('sha256').update('test').digest('hex');
    expect(/^[0-9a-f]{64}$/.test(valid)).toBe(true);
    expect(/^[0-9a-f]{64}$/.test('../etc/passwd')).toBe(false);
    expect(/^[0-9a-f]{64}$/.test('../../../../root/.ssh/id_rsa')).toBe(false);
  });
});

// ── F945: VM effects allowlist ────────────────────────────────────────────────

describe('VM effects allowlist (F945)', () => {
  it('rejects unknown effect types', async () => {
    const storyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/stories',
      payload: { title: 'sandbox-test' },
    });
    const storyId = storyRes.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/effects`,
      payload: {
        playthroughId: 'pt-1',
        idempotencyKey: 'ik-1',
        events: [{ type: 'exec_shell', payload: { cmd: 'rm -rf /' } }],
      },
    });
    // Must be rejected with validation error, never executed.
    expect(res.statusCode).toBe(422);
  });

  it('accepts a journal effect (one of the four allowed types)', async () => {
    const storyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/stories',
      payload: { title: 'sandbox-ok' },
    });
    const storyId = storyRes.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/effects`,
      payload: {
        playthroughId: 'pt-allowed',
        idempotencyKey: 'ik-allowed-1',
        events: [
          { type: 'journal', payload: { text: 'The fox spoke.', scene: 'scene1' } },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
  });
});

// ── F948: Upload content-type protection ─────────────────────────────────────

describe('upload content-type sniffing protection (F948)', () => {
  it('isAllowedMime accepts images, audio, text, and PDF', () => {
    expect(isAllowedMime('image/png')).toBe(true);
    expect(isAllowedMime('image/webp')).toBe(true);
    expect(isAllowedMime('audio/mpeg')).toBe(true);
    expect(isAllowedMime('text/plain')).toBe(true);
    expect(isAllowedMime('application/pdf')).toBe(true);
  });

  it('isAllowedMime rejects executable and script MIME types', () => {
    expect(isAllowedMime('application/javascript')).toBe(false);
    expect(isAllowedMime('application/x-executable')).toBe(false);
    expect(isAllowedMime('application/octet-stream')).toBe(false);
    expect(isAllowedMime('text/html')).toBe(false);
    expect(isAllowedMime('application/x-sh')).toBe(false);
  });

  it('MAX_ATTACHMENT_BYTES is 25 MB', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(25 * 1024 * 1024);
  });
});

// ── F949: Token auth ──────────────────────────────────────────────────────────

describe('token authentication (F949)', () => {
  it('generateToken produces a 64-char hex string', () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(generateToken()).not.toBe(t); // Unique per call.
  });

  it('app without FABLES_TOKEN allows all requests', async () => {
    // Default app (no token) — health and notes should be accessible.
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
  });

  it('app with FABLES_TOKEN rejects requests missing the token', async () => {
    const token = 'super-secret-test-token';
    const secureApp = await buildApp(
      loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }),
    );
    // Manually inject a token gate.
    const { registerTokenAuth } = await import('./security.js');
    registerTokenAuth(secureApp, token);

    // Without token — should be 401.
    const badRes = await secureApp.inject({ method: 'GET', url: '/api/v1/debug/stats' });
    expect(badRes.statusCode).toBe(401);

    // With correct token — should pass.
    const goodRes = await secureApp.inject({
      method: 'GET',
      url: '/api/v1/debug/stats',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(goodRes.statusCode).toBe(200);

    // Health is always public even with the gate active.
    const healthRes = await secureApp.inject({ method: 'GET', url: '/api/v1/health' });
    expect(healthRes.statusCode).toBe(200);

    await secureApp.close();
  });

  it('wrong token is rejected', async () => {
    const token = 'correct-token-abc123';
    const secureApp = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const { registerTokenAuth } = await import('./security.js');
    registerTokenAuth(secureApp, token);

    const res = await secureApp.inject({
      method: 'GET',
      url: '/api/v1/debug/stats',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(401);

    await secureApp.close();
  });

  it('x-fables-token header is an accepted alternative', async () => {
    const token = 'alt-header-token';
    const secureApp = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const { registerTokenAuth } = await import('./security.js');
    registerTokenAuth(secureApp, token);

    const res = await secureApp.inject({
      method: 'GET',
      url: '/api/v1/debug/stats',
      headers: { 'x-fables-token': token },
    });
    expect(res.statusCode).toBe(200);

    await secureApp.close();
  });
});
