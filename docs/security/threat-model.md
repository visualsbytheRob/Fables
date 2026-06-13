# Fables Threat Model

## Deployment Context

Fables is a **single-user, local-first** application served on a personal Tailscale mesh network
(`tailscale serve`). The ts.net HTTPS certificate and Tailscale's WireGuard tunnel are the primary
security perimeter. This shapes the threat model significantly.

## Trust Boundary

```
[User's iPhone / Browser]
        |
  WireGuard (Tailscale)     ← primary perimeter
        |
  tailscale serve / HTTPS   ← TLS termination
        |
  Fables server (localhost)
        |
  ~/.fables/fables.sqlite   ← single-owner data
```

## Assets

| Asset | Sensitivity | Location |
|---|---|---|
| Notes / story content | High (personal intellectual property) | `~/.fables/fables.sqlite` |
| Attachments | High | `~/.fables/attachments/` |
| Entity/world state | High | SQLite |
| Auth token (`FABLES_TOKEN`) | High | env var / config only |
| Backups | High | `~/.fables/backups/` |

## Threat Actors

1. **Network attacker on the same tailnet** — mitigated by Tailscale ACLs (keep them tight).
2. **Malicious story content / clips** — user may ingest attacker-controlled Markdown/HTML.
3. **Malicious attachment uploads** — MIME allowlist + size limits enforced server-side.
4. **Runaway scripts / bots hitting the API** — rate limiting (600 req/min) in place.
5. **Physical access to the machine** — out of scope; disk encryption is the control.
6. **Supply-chain attack on npm deps** — `pnpm audit` in CI; lockfile committed.

## Mitigations in Place

### XSS / HTML Injection (F942)
- The server stores note bodies as **raw Markdown**; it never renders HTML server-side.
- HTML rendering happens client-side (web app), where a sanitizer (DOMPurify or equivalent)
  should be applied before `innerHTML` injection.
- Web-clipper HTML extraction uses `@mozilla/readability` → Markdown conversion; raw HTML
  is never stored or re-served.
- Story `.fable` source files are plain text; the VM never evaluates arbitrary HTML.

### SQL Injection (F943)
- All queries use `better-sqlite3` prepared statements with `?` placeholders.
- Dynamic ORDER BY clauses use hardcoded column/direction dictionaries (not user strings).
- No `db.exec` calls with user-supplied content. See `audit:sql-injection` test.

### Path Traversal (F944)
- Attachment serving resolves paths through `attachmentPath(dataDir, hash)` where `hash`
  is a server-computed SHA-256 hex string (64 lowercase hex chars), not user-supplied.
- The route ID is looked up in the database first; the file path is derived from the
  stored hash, never from the request URL.
- The `hash` is validated against `/^[0-9a-f]{64}$/` in the attachment store list function.
- See `audit:path-traversal` test.

### Story VM Sandbox (F945)
- The VM effect allowlist is defined in `routes/effects.ts` using a Zod discriminated union.
- Only four effect types are accepted: `journal`, `entity_set`, `encounter`, `reveal`.
- All effect payloads are validated against typed Zod schemas before processing.
- Effects are rejected server-side; the VM itself cannot call arbitrary Node APIs.

### Security Headers (F947)
- `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, and related
  headers are set via the `addSecurityHeaders` hook in `app.ts`.

### Upload Content-Type Protection (F948)
- MIME allowlist enforced in `routes/attachments.ts:isAllowedMime()`.
- The `Content-Type` header from multipart uploads is checked; browser sniffing is
  disabled via `X-Content-Type-Options: nosniff`.

### Token Authentication (F949)
- Optional single-user token gate: set `FABLES_TOKEN=<secret>` in the environment.
- Constant-time comparison using Node's `crypto.timingSafeEqual` to prevent timing attacks.
- Token can be passed as `Authorization: Bearer <token>` or `x-fables-token` header.
- Off by default; health endpoint is always public for uptime checks.

### Secrets Management (F950)
- No secrets committed to the repo; `.env.example` provides a template.
- `pnpm audit` runs in CI against the lockfile.
- `git-secrets` or `trufflehog` recommended as a pre-push hook (see scripts/secrets-scan.md).

## Not In Scope

- Multi-user access control (Fables is deliberately single-user).
- Tailscale Funnel (explicitly disabled by default — see `docs/tailscale.md`).
- Automated updates (pull and restart is manual — see F967).
