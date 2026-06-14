/**
 * Security hardening (F941–F950): headers, token auth, upload protection.
 *
 * Security headers (F947) are injected via an `onSend` hook so they apply to
 * every response — API JSON, static files, and the SPA fallback alike.
 *
 * Token auth (F949): when `FABLES_TOKEN` is set in the environment, every
 * request (except `/api/v1/health`) must include the matching bearer token.
 * Constant-time comparison prevents timing attacks.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// ── Security headers (F947) ─────────────────────────────────────────────────

/**
 * Registers an `onSend` hook that adds security headers to every response.
 * Called from `buildApp()`.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_req: FastifyRequest, reply: FastifyReply) => {
    // Disable MIME-type sniffing (F948) — forces browser to trust Content-Type.
    reply.header('X-Content-Type-Options', 'nosniff');

    // Prevent framing (clickjacking).
    reply.header('X-Frame-Options', 'SAMEORIGIN');

    // Referrer policy — don't leak the ts.net origin to third-party resources.
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions policy: no geolocation, payment, or camera except for the
    // PWA's own mic (voice capture F781).
    reply.header('Permissions-Policy', 'geolocation=(), payment=(), camera=(), microphone=(self)');

    // Content-Security-Policy (F947).
    // Single-user tailnet app: strict policy with `self` sources only.
    // `unsafe-inline` for style is required by Vite-built CSS; remove when
    // migrating to hashed/nonce styles.
    // `blob:` and `data:` for audio/attachments (voice memo F781, images).
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        // Allow inline styles from the React app; tighten when nonces are added.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        // No plugins/embeds; lock down framing, form, and base targets (F1261).
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'self'",
      ].join('; '),
    );
  });
}

// ── Token authentication (F886 / F949) ──────────────────────────────────────

/** PUBLIC paths that bypass token auth even when the gate is active. */
const PUBLIC_PREFIXES = ['/api/v1/health'];

/**
 * Returns a constant-time comparison function for the given secret token.
 * We hash both sides to the same length so `timingSafeEqual` always sees
 * equal-length buffers (required by the API).
 */
function makeCompare(secret: string): (candidate: string) => boolean {
  const expected = createHash('sha256').update(secret).digest();
  return (candidate: string): boolean => {
    const actual = createHash('sha256').update(candidate).digest();
    // timingSafeEqual requires same-length buffers — sha256 is always 32 bytes.
    return timingSafeEqual(expected, actual);
  };
}

/**
 * Extracts the bearer token from `Authorization: Bearer <token>` or the
 * `x-fables-token` header (fallback for iOS PWA where custom headers are
 * easier to set via a fetch wrapper).
 */
function extractToken(request: FastifyRequest): string | null {
  const auth = request.headers['authorization'];
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const custom = request.headers['x-fables-token'];
  if (typeof custom === 'string') return custom.trim();
  return null;
}

/**
 * Registers a preHandler hook that enforces bearer-token authentication when
 * `FABLES_TOKEN` is set. Off by default (no token = open access — the
 * Tailscale perimeter is the intended boundary).
 *
 * @param token  The expected secret from env/config. Pass `undefined` to disable.
 */
export function registerTokenAuth(app: FastifyInstance, token: string | undefined): void {
  if (!token) return; // Gate is off — nothing to register.

  const compare = makeCompare(token);

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Public paths are always allowed (uptime checks).
    for (const prefix of PUBLIC_PREFIXES) {
      if (request.url.startsWith(prefix)) return;
    }

    const candidate = extractToken(request);
    if (candidate && compare(candidate)) return; // Valid token.

    reply
      .status(401)
      .header('WWW-Authenticate', 'Bearer realm="Fables"')
      .send({
        error: { code: 'FORBIDDEN', message: 'invalid or missing auth token', details: null },
      });
  });
}

// ── Token rotation helper (F949) ─────────────────────────────────────────────

/**
 * Generates a cryptographically-random token suitable for use as FABLES_TOKEN.
 * Usage: `node -e "import('./dist/security.js').then(m => console.log(m.generateToken()))"`
 */
export function generateToken(): string {
  return createHash('sha256')
    .update(crypto.randomUUID())
    .update(Date.now().toString())
    .digest('hex');
}
