# Fables Security Model — Technical (F1295)

For readers who want the precise model. Pairs with `crypto-design.md` (primitive
choices), `threat-model-v2.md` (adversaries), and `privacy-data-flow.md`.

## Trust model

- **Single-tenant, local-first.** The server runs on the user's machine; the
  network perimeter is a Tailscale tailnet. There is no multi-tenant server to
  compromise and no third-party data processor.
- **The user's unlocked machine is trusted.** Encryption protects data _at rest_;
  it does not defend against malware running as the user while the vault is open.

## Key hierarchy

```
passphrase ──Argon2id(salt, tuned ops/mem)──▶ master key (never persisted)
                                                  │ wraps (XChaCha20-Poly1305)
                                                  ▼
                                         data key (DEK, random 256-bit)
                                                  │ encrypts
                          ┌───────────────────────┼───────────────────────┐
                       note fields          attachment blobs        backup archive
                     (enc:v1: codec)        (FAE1 + sealed)        (FBK2 + sealed)
```

- The **master key** is derived on unlock and held only in process memory.
- The **DEK** is generated once, stored only wrapped under the master key. A
  passphrase change re-derives the master key from a fresh salt and re-wraps the
  DEK — content is never re-encrypted (O(1) passphrase change).
- A **wrong passphrase** is detected by the wrapped-DEK AEAD tag failing to
  authenticate — no separate verifier, no padding oracle.

## Primitives

- KDF: Argon2id (`crypto_pwhash`, ALG_ARGON2ID13), tuned + versioned params.
- AEAD: XChaCha20-Poly1305 IETF with a 192-bit random nonce per `seal()` — nonce
  reuse is impossible by construction (callers cannot supply a nonce).
- Hash chain (audit log): SHA-256 over `seq | event | detail | ts | prev_hash`.
- Constant-time comparison via libsodium `memcmp`; keys zeroed on lock.
- Self-describing, versioned envelopes (`enc:v1:` fields, `FAE1`/`FBK2` blobs) so
  parameters can be rotated without guessing how old data was written.

## At-rest coverage

| Data                                | At rest                                     | Mechanism                                |
| ----------------------------------- | ------------------------------------------- | ---------------------------------------- |
| Note title/body                     | ciphertext (vault on)                       | `notesRepo(db, codec)` field codec       |
| Attachments                         | ciphertext (vault unlocked)                 | `FAE1` + sealed blob                     |
| Backups                             | ciphertext (vault unlocked)                 | `FBK2` envelope over the v1 archive      |
| Note ids, timestamps, notebook tree | plaintext (by design)                       | needed for list/sort/sync without unlock |
| Security audit log                  | plaintext events (no secrets), hash-chained | tamper-evident                           |

The metadata boundary is deliberate and documented (`privacy-data-flow.md`): the
app can list and order content while locked, but cannot read it.

## Network & process hardening

- **SSRF:** outbound URL fetches resolve DNS and reject any private/reserved/
  loopback/link-local/CGNAT/metadata address (defeats DNS-rebinding); http(s)
  only. Wired into the clipper/ingest path and regression-tested end-to-end.
- **Headers/CSP:** `default-src 'self'`, `object-src 'none'`, `frame-ancestors
'none'`, nosniff, frame-options, referrer + permissions policy.
- **Auth:** optional `FABLES_TOKEN` bearer gate (constant-time compare); the
  tailnet is the primary perimeter.
- **Supply chain:** every dependency uses a bounded, registry-pinned specifier,
  enforced by a test; pnpm lockfile frozen in CI.

## Known limitations / non-goals (explicit)

- Forgotten passphrase ⇒ unrecoverable data (the guarantee, not a bug).
- App-wide encrypted **search** over encrypted notes is not yet live (the
  persistent FTS only sees ciphertext); a post-unlock in-memory index is the
  planned approach (F1213).
- No protection against a compromised, unlocked endpoint.
- WebAuthn/passkey unlock and a device-bound quick-PIN are scaffolded but not
  implemented.
