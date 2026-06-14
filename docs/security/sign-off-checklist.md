# Epic 13 Security Sign-off Checklist (F1299)

An honest checklist of the security tier's posture. ✅ shipped + tested · ⚠️
partial/follow-on · ⬜ not started.

## Crypto core

- ✅ Audited primitives (Argon2id, XChaCha20-Poly1305), documented choices
- ✅ Key hierarchy: master→DEK, passphrase change re-wraps (no re-encrypt)
- ✅ Internal random nonces (no caller-supplied nonce path)
- ✅ Branded key types; constant-time compare; key zeroing
- ✅ Versioned, self-describing envelopes
- ✅ Pinned known-answer tests

## At-rest encryption

- ✅ Note title/body field codec (mixed plaintext/ciphertext safe)
- ✅ Attachments encrypted on the live upload/download path (403 when locked)
- ✅ Encrypted backup v2 (FBK2 envelope) with locked-restore refusal
- ⚠️ App-wide note read/write codec wiring (route does it; derived services +
  encrypted search F1213 pending)
- ⬜ Vault conversion migration (F1215) — blocked on the codec wiring

## Key management & lock

- ✅ Unlock/create UX, recovery codes, honest data-loss messaging
- ✅ Passphrase change, fingerprint display, session-duration setting
- ✅ Auto-lock on idle, lock-on-background, panic lock, locked-state gate
- ✅ In-memory key purge on lock; cross-tab coordination
- ⚠️ WebAuthn/passkey (F1224), quick-PIN (F1235) — scaffolded, not implemented
- ⬜ Emergency export (F1228), pending-edit preservation (F1238)

## Sync & collab

- ✅ Encrypted op-log + CRDT update primitives; server-compromise property proven
- ⬜ Live wiring into the op-store/relay; device key exchange (F1253–F1257)

## Hardening

- ✅ SSRF guard (DNS-resolved private/metadata blocking) wired + regression-tested
- ✅ Security headers + CSP (object-src 'none')
- ✅ Supply-chain pinning policy (enforced by test)
- ✅ Clipboard hygiene; read-receipts opt-out
- ⚠️ SRI manifest (F1262), memory-safe preview helper (F1265) — partial

## Compliance & audit

- ✅ Tamper-evident hash-chained audit log + verification
- ✅ Full vault wipe with re-auth + verification
- ✅ Data inventory export, legal hold, redaction + export-with-redactions
- ✅ Per-notebook retention with legal-hold-respecting auto-purge

## Documentation

- ✅ Threat model v2, attack tree, crypto design, privacy data-flow, incident
  response, secure defaults, supply-chain, vault guide, compliance
- ✅ Security model for humans + experts, FAQ, this checklist
- ⬜ Plugin permission-escalation analysis (F1273), pen-test e2e suite (F1279)

## Verdict

The encrypted-vault tier is **production-usable for the core flows** (notes-at-
rest, attachments, backups, lock/unlock, audit, compliance) with an honest set of
follow-ons — chief among them the app-wide codec wiring + encrypted search, which
is the next keystone. No known plaintext-at-rest leaks on the shipped paths; the
deferred items are tracked, not forgotten.
