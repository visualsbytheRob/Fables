# Security & Privacy in Fables

This document describes the security and privacy model for Fables, a single-user personal Knowledge OS deployed locally over Tailscale. **Read this to understand what data lives where, who can access it, and what we protect against.**

## Executive Summary

- **Your vault stays on your machine.** All data lives in `~/.fables` on disk. No cloud, no servers (except your own).
- **Tailnet as the perimeter.** Phone access is over your private Tailscale VPN. No public internet exposure by default.
- **Single-user design.** Fables assumes one person owns the machine and the vault. Multi-user access is not yet supported.
- **Threat model:** we protect against remote attackers and accidental data leaks. We do not protect against a local attacker with physical access to your machine.

---

## What Data We Protect

### Local Data (on disk: `~/.fables`)

- **SQLite database (`fables.db`):** all notes, entities, stories, saves, revision history.
- **Attachments:** images, PDFs, audio files stored in `attachments/` directory.
- **Logs:** server logs in `logs/` directory (contain operation summaries, no sensitive note content).
- **Op-log:** sync operations in the database (Lamport-timestamped mutations).

**Protection:** file-system permissions. `~/.fables` is created with mode `0755` (readable by the user's account only). An attacker without filesystem access cannot read the database.

### Network Data (Tailscale tunnel)

- **API requests:** HTTP(S) REST calls from phone to server.
- **Request/response bodies:** JSON payloads (notes, entities, search queries, etc.).

**Protection:** TLS encryption (Tailscale's `ts.net` certs are valid, signed by Tailscale's CA). All communication over Tailscale is encrypted and authenticated.

### Browser Cache (phone)

- **Service worker cache:** app shell (HTML, CSS, JS) stored in the PWA cache.
- **IndexedDB:** mirrored copy of notes, entities, story metadata on the phone.
- **localStorage:** user preferences, draft recovery, annotation registry.

**Protection:** encrypted by iOS's native database encryption (at rest). On logout or app uninstall, Safari clears IndexedDB.

---

## Threat Model

### We Protect Against

1. **Remote network attackers** (person on the internet trying to access your vault).
   - **Mitigation:** Tailscale VPN. Only devices on your tailnet can access Fables. No public internet exposure without explicit opt-in (Tailscale Funnel, disabled by default).

2. **Passive eavesdropping** on your WiFi or ISP.
   - **Mitigation:** TLS encryption (Tailscale provides valid certs). Tunnel is encrypted end-to-end.

3. **Man-in-the-middle (MITM)** on the phone's Tailscale connection.
   - **Mitigation:** Tailscale's WireGuard mesh is authenticated. Your phone validates Tailscale's certificate.

4. **Cross-site scripting (XSS)** in the web app.
   - **Mitigation:** HTML sanitization on all user-generated content (note bodies, story text, imported Markdown). DOMPurify used on render. No inline scripts in app shell.

5. **SQL injection** in API endpoints.
   - **Mitigation:** all database queries use parameterized statements. No string concatenation of user input into SQL.

6. **Story VM sandbox escape** (malicious `.fable` code accessing host memory).
   - **Mitigation:** effect allowlist (F485). Stories can only call pre-approved effects (`@journal`, `@entity_set`, `@encounter`). Arbitrary host access is blocked.

7. **Attachment exploits** (malicious PDF/image uploads).
   - **Mitigation:** file-type allowlist. MIME-type sniffing guards. PDFs are served as `application/pdf` with `Content-Disposition: attachment` to prevent inline rendering.

8. **Accidental secrets in notes** (API keys pasted into note bodies).
   - **Mitigation:** we do not scan for secrets automatically. You control what you write. Consider using a password manager for sensitive credentials, not Fables.

### We Do NOT Protect Against

1. **Physical access to your machine.** If someone steals your laptop, they can read `~/.fables` unencrypted (encryption at rest is a Tier-2 feature, F979).

2. **Compromised machine (malware, rootkit).** If your OS is compromised, all security layers fail. Fables assumes your machine is trustworthy.

3. **Forgotten Tailscale session.** If you leave your phone unlocked on the Tailscale VPN, anyone with physical access can open Fables. Lock your phone with a strong passcode.

4. **Single-user token exposure.** The optional bearer token (F886) is long-lived and stored in a cookie. If leaked, an attacker can make API calls. The token is single-user; consider it equivalent to your login cookie. **Don't share the token.**

5. **Account compromise (if cloud backups enabled in future).** Tier-2 features may add cloud backup. If we do, we'll encrypt it client-side. Until then, there's no cloud.

---

## Security Controls by Layer

### Network Layer

- **Tailscale VPN:** encrypted WireGuard tunnel, authenticated peers, zero-trust model. Only your registered devices can access Fables.
- **HTTPS (TLS 1.3):** Tailscale's `ts.net` domain uses valid certs signed by their CA. Browser validates the cert on every request.
- **HSTS not enabled** (because we're on a tailnet domain, HSTS not needed; Tailscale handles it).
- **Optional token auth (F886):** single bearer token passed in `Authorization: Bearer <token>` header. Constant-time comparison on server. Long-lived cookie for PWA sessions.

### Application Layer

- **Input validation:** all incoming JSON payloads validated against Zod schemas. Invalid input rejected before processing.
- **Output encoding:** JSON responses are valid UTF-8 JSON (no HTML/JavaScript injection risk).
- **Markdown sanitization:** DOMPurify on all rendered markdown (notes, story text, clips).
- **Path traversal protection:** attachment serving checked to ensure paths stay within `~/.fables/attachments/`.
- **CORS:** server only accepts requests from Tailscale origins (`*.ts.net` or `127.0.0.1` in dev).

### Database Layer

- **Parameterized queries:** all SQL queries use bound parameters. Grep verification in tests (F943).
- **Foreign key constraints:** enforced on schema. Orphaned rows prevented at the database level.
- **Transaction isolation:** multi-repo operations wrapped in transactions to prevent partial updates.
- **Optimistic concurrency:** `rev` field prevents lost updates; concurrent edits detected early.

### Story VM Layer

- **Effect allowlist:** only pre-approved effects can be called from Forge code. New effects require server-side registration.
- **External state sandboxing:** knowledge bindings are read-only or explicitly mutable (entity fields). No arbitrary host access.
- **Step budget:** VM has a max step count to prevent infinite loops. Breaks after configurable limit (default: 1 million steps).
- **Type checking:** compiler verifies all expressions are well-typed before bytecode is generated.

### Cache Layer (Service Worker & IndexedDB)

- **Cache versioning:** cache keys include app version. Old caches cleared on new app install.
- **IDB encryption at rest:** iOS and Android encrypt IndexedDB natively (OS-level encryption).
- **Cache eviction:** LRU policy on attachments cache; old entries purged when quota exceeded.
- **No sensitive data in localStorage:** only preferences and non-sensitive metadata cached in localStorage.

---

## Privacy & Data Ownership

### What We Collect

**Server-side:**
- Your notes, entities, stories, and saves (you wrote them; you own them).
- Sync operations (Lamport-timestamped mutations, used for conflict resolution).
- Server logs (operation summaries, request counts; NOT note content).
- Optional local usage statistics (feature counters, zero network egress).

**We do NOT:**
- Send data to external servers.
- Track your behavior across sessions.
- Sell or share your data.
- Use embeddings for profiling (embeddings computed locally, not sent anywhere).

### What You Can Do

- **Export everything:** in Settings, export your entire vault as a `.fablesbak` archive (tar.zstd). Portable, can be restored to a different machine.
- **View your data:** everything is in `~/.fables`. You can inspect it directly with SQLite.
- **Delete permanently:** use soft-delete in the UI or delete files on disk. The trash bin is truly local; no cloud copy exists.

---

## Best Practices

### For Users

1. **Keep your machine updated.** OS patches close security holes. Run `brew update` / `apt update` regularly.

2. **Use a strong login password.** Your machine's login is the first line of defense. Use a unique, long password.

3. **Lock your phone when away.** If your iPhone is unlocked and on the Tailscale VPN, anyone can open Fables.

4. **Don't share the token.** If you've enabled the bearer token (F886), don't paste it into chat or emails. It's a long-lived credential equivalent to a login.

5. **Keep Tailscale on only when needed.** You can toggle Tailscale on/off in the mobile app. When off, the phone can't access Fables (good for security, bad for offline reading). If you're in a public place, you might toggle it off temporarily.

6. **Verify the URL.** When opening Fables on iPhone, ensure the URL is your actual `https://mymachine.mytailnet.ts.net`. Phishing could present a fake URL.

7. **Use a password manager.** Don't store API keys or passwords in Fables. Use a dedicated password manager (1Password, Bitwarden, etc.).

### For Administrators (if you deploy Fables to a group machine in future)

1. **Isolate the data directory.** If Fables ever becomes multi-user, use `--data-dir` to give each user their own `~/.fables-<username>`. Do not share the directory.

2. **Audit the token.** If using the bearer token, rotate it periodically and audit access logs.

3. **Monitor the logs.** Set `LOG_LEVEL=debug` and review logs for suspicious activity (unusual IPs, repeated failed lookups, etc.).

4. **Enforce Tailscale ACLs.** In your Tailscale admin panel, restrict which devices can access Fables. Only user devices, not random machines.

---

## Audit & Compliance

### SQL Injection Testing

All API routes tested to ensure parameterized queries are used. Grep verification (F943):

```bash
grep -r "db.prepare(" apps/server/src/routes/*.ts | grep -v "db.prepare(" | wc -l
# Should be 0 (no raw SQL strings)
```

### XSS Testing

Every note preview and story text render goes through DOMPurify with a strict config:
```javascript
DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p', 'br', 'strong', ...] })
```

Tests verify malicious payloads are neutered (F942).

### CSRF Protection

All state-changing endpoints require POST with a JSON body. CORS is restricted to tailnet origins. CSRF tokens not needed on a tailnet app (low-risk environment).

### Dependency Audit

`pnpm audit` run on every PR. Critical vulnerabilities block merge. Lockfile (`pnpm-lock.yaml`) checked into version control.

---

## Encryption (Tier 2)

**Currently:** data is stored unencrypted on disk. Anyone with filesystem access can read it.

**Planned (F979):** optional end-to-end encryption with a master passphrase. Notes would be encrypted at rest in the database. Encryption keys derived from the passphrase, never sent to server. When you log in, you unlock the passphrase and Fables decrypts notes on demand.

---

## Security Incident Response

If you discover a security vulnerability:

1. **Do not post it publicly.** File a private GitHub security advisory or email the maintainers.
2. **Include details:**
   - What you can do (e.g., read arbitrary notes, escape the VM)
   - Steps to reproduce
   - Your Fables version and OS

We will:

1. Acknowledge receipt within 24 hours.
2. Work on a fix.
3. Release a patch.
4. Credit you in the changelog (if you want).

---

## Timeline & Roadmap

- **Tier 1 (F801–F900):** current. Single-user, Tailnet perimeter, local-first offline-capable.
- **Tier 2 (F901–F1000):** hardening & ship. Security audit (F941–F950), threat model, encryption at rest.
- **Beyond:** multi-user support, end-to-end encryption, plugin sandboxing, advanced threat modeling.

---

## Further Reading

- **Tailscale threat model:** https://tailscale.com/security/ (overview of Tailscale's security model)
- **OWASP Top 10:** https://owasp.org/Top10/ (common web app vulnerabilities we guard against)
- **Markdown sanitization:** https://github.com/cure53/DOMPurify (the library we use)
- **SQLite security:** https://www.sqlite.org/security.html (parameterized query guidance)

---

**Last updated:** Day 9. This document describes the security model as of feature set F801–F900. For the latest, see the source in `apps/server/src/security/` and `packages/sync/`.
