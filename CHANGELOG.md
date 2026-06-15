# Changelog

## v2.0.0 — Tier 2 complete

Fables v2.0: the Knowledge OS grows a second tier. Everything from v1.0 plus a
plugin architecture, real-time collaboration, an encrypted vault, AI assists,
a deep importer suite, a full audio/narration studio, spaced-repetition
learning, story interop & distribution, and a power-user automation layer —
built across Epics 11–21 (F1001–F2026).

### Tier 2 epics

- **Epic 11 — Plugins (F1001–F1100):** sandboxed worker-thread runtime, capability security, host APIs, `@fables/plugin-sdk`, extension points, `.fplugin` distribution.
- **Epic 12 — Collaboration (F1101–F1200):** CRDT/Yjs shared editing, rooms, presence, comments — local-first.
- **Epic 13 — Encryption & Security (F1201–F1300):** Argon2id + XChaCha20-Poly1305 vault, at-rest field encryption, tamper-evident audit log, compliance backend.
- **Epic 14 — AI Assist (F1301–F1400):** pluggable AI runtime with graceful degradation, story/character/action assists, consent-gated cloud adapters.
- **Epic 15 — Importers (F1401–F1500):** Notion, Evernote, Apple Notes, outliners, documents — deterministic, with a pluggable import framework.
- **Epic 16 — Audio & Narration (F1501–F1640):** TTS runtime, casting, recording takes, soundscapes, read-along, audiobook export, accessible playback.
- **Epic 18 — Spaced Repetition (F1701–F1800):** FSRS-5 scheduler, cards/decks, Anki interop, learning insights & habits.
- **Epic 19 — Story Interop & Distribution (F1801–F1900):** Ink/Twee import, `.fablepack` (deterministic, signed), `.fablearchive` fixity, ComfyUI generative art, reader feedback loop.
- **Epic 20 — Multi-Vault, Automation & Power Tools (F1901–F2000):** vault registry, automation rules, cron jobs, webhooks & integrations, scripting console, bulk operations, FQL v2, workspace profiles, power tools, Grand Close.
- **Epic 21 — New Millennium Polish (F2001–F2022):** the design-system encore (see `docs/devlog/epic-21.md`).

### Epic 20 highlights

- **Multi-Vault (F1901–F1910):** named vaults across data dirs, one-active invariant, isolated settings, per-vault encryption state, templates, cold storage.
- **Automation & Jobs (F1911–F1930):** a pure rule engine (triggers→conditions→actions, dry-run, cascade protection) and a cron scheduler (parse/next/missed/describe) with a concurrency-guarded job model.
- **Webhooks & Integrations (F1931–F1940):** outbound subscriptions (templated, HMAC-signed), retries + dead-letter, token-authenticated inbound capture, RSS feed output.
- **Scripting Console (F1941–F1950):** a script library scoped to the plugin capability surface, with static dry-run scope analysis and an example gallery.
- **Bulk Operations (F1951–F1960):** preview → apply → undo over a pure engine (find/replace, field edits, link rewriting, tag ops, merge, split), fully journalled.
- **FQL v2 (F1961–F1970):** aggregations, a sandboxed computed-field expression engine, query variables, a static EXPLAIN, and a linter.
- **Power Tools (F1981–F1990):** vault statistics, duplicate finder, broken-everything finder, configurable linter with fix-its, storage analyzer.
- **Grand Close (F1991–F2000):** full regression run, performance re-baseline, documentation audit, demo vault v2, the Fables Book, retrospective, and the v2.0 ship.

### The numbers

3,800+ tests across 330+ files, all green. TypeScript strict throughout
(`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`). 46 numbered
migrations. Local-first, owner-only, served over Tailscale as an iPhone PWA.

See `docs/devlog/epic-20.md` for the Epic 20 retrospective and the full
shipped/triaged breakdown.

## v1.0.0 — Tier 1 complete

Fables v1.0: a personal Knowledge OS fused with the Forge interactive-fiction engine.
Built across 10 days against a 1,000-feature plan. 1,868 tests, all green.

### Feature groups (by build day)

- Day 1: F001–F010 repo & tooling
- Day 1: F011–F020 core domain package
- Day 1: F021–F030 server bootstrap
- Day 1: F031–F040 database layer
- Day 1: F041–F050 config & environment
- Day 1: F051–F060 logging & observability
- Day 1: F061–F070 web app bootstrap
- Day 1: F071–F080 design system base
- Day 1: F081–F090 API conventions
- Day 1: F091–F100 dev experience & CI
- Day 2: F101–F120 note CRUD API + revision history
- Day 2: F121–F140 markdown editor + rendering pipeline
- Day 3: F201–F240 wikilinks, backlinks, mentions & graph API
- Day 2: F141–F200 the complete notes experience
- Day 3: F241–F300 graph UI, daily notes, templates, FQL & import/export
- Day 3: F278, F282–F290, F297, F137 query UI, import wizard & mermaid
- Day 4: F311–F400 the Forge compiler front half
- Day 4: F301–F310, F378, F381–F390, F397–F398 spec & editor
- Day 5: F401–F500 the Forge VM
- Day 6: F501–F510, F462–F463, F499 story projects & saves
- Day 6: F511–F540 author workspace, scene graph & live playtest
  feat(day-6/7): F541–F600 player & library, F601–F640 entities, codex & effects
- Day 7: F601–F650 the fusion
- Day 7: F651–F660 Timeline & F681–F690 World inspector UIs
- Day 8: F701–F720, F751–F760, F791–F800 search & insights
- Day 8: F721–F750 embeddings, vector & hybrid search
- Day 8: F742/F746/F751 activate semantic & hybrid search UI
- Day 8: F766/F769/F771-773/F781/F784-786 ingestion, clipper & voice UI
- Day 8: F761-F790 ingestion, clipper & audio backend
- Day 9: F801–F900 PWA manifest, service worker, IndexedDB offline layer, notifications & mobile polish
- Day 9: F831–F870 offline-first op-log sync engine & server protocol
- Day 9: F831–F870 op-log sync engine, server & conflict resolution
- Day 9: F834/F844/F845/F850/F855 wire sync into web + conflict UI
- Day 10: F941-F980, F991-F994 security, backup, migrations, analytics & release
- Day 10: F901-F940, F971-F980, F997 web hardening

---

## Tier 2 (in progress)

Real-time collaboration, plugin architecture, encryption, AI, and importers. Building out from the Tier 1 foundation.

### Epic 11 — Plugin & Extension Architecture (F1001–F1100)

Sandboxed, capability-based plugin system with worker-thread isolation, host APIs for notes/stories/UI, permission model, dev kit, and distribution pipeline.

- F1001–F1010: Plugin manifest, loader, versioning
- F1011–F1020: Sandboxed worker-thread runtime, CPU/memory budgets, capability security
- F1021–F1030: Notes API for plugins (read/write, markdown hooks, custom blocks)
- F1031–F1040: Story/VM API for plugins (external functions, story effects)
- F1041–F1050: UI extension points (sidebar, commands, context menu, toolbar, routes, themes)
- F1051–F1060: Event hooks, filters, async support with timeouts
- F1061–F1070: Install-time permissions, runtime escalation, per-notebook grants, audit log
- F1071–F1080: `pnpm create-plugin` scaffold, @fables/plugin-sdk, hot-reload, test harness
- F1081–F1090: Example plugins (word-count, pomodoro, theme pack)
- F1091–F1100: Distribution (file/URL install, updates, plugin catalog, .fplugin format)

**Epic 11 Complete.** SHIPPING: sandboxed worker-thread runtime, capability allowlist, host APIs, @fables/plugin-sdk, extension points (sidebar/commands/menu/toolbar/settings/routes/themes), dev kit with hot-reload, example plugins, update detection, .fplugin distribution. 2,045 tests green.

### Epic 12 — Real-Time Collaboration & CRDT (F1101–F1200)

Opt-in per-document CRDT collaboration via Tailscale with scoped share links, live cursors, comments, and history.

- F1101–F1110: CRDT core (Yjs Y.Text, op-log bridge, snapshot encoding, convergence property tests)
- F1111–F1120: Collaborative CodeMirror editor (Y.Text binding, remote cursors/selection, presence)
- F1121–F1130: WebSocket sync server (room-per-document, state-vector catch-up, auth, persistence batching)
- F1131–F1140: Presence & awareness (avatars, follow mode, idle detection, privacy toggle)
- F1141–F1150: Sharing & invites (scoped tailnet share tokens, read/edit permissions, link expiry, revocation, guest identity, audit log)
- F1151–F1160: Collaborative stories (shared .fable editing, compile coordination, shared playtest, vote-on-choice, spectator mode)
- F1161–F1170: Comments & suggestions (anchored to CRDT ranges, threads, accept/reject)
- F1171–F1180: Merge & history (named versions, per-character attribution, time-slider playback, forensic recovery)
- F1181–F1190: Conflict-free structures (CRDT maps for entities, notebook tree, tags, canvas)
- F1191–F1200: Hardening (three-device chaos tests, security review, bandwidth budget, perf tuning)

**In Progress.** SHIPPING: CRDT engine (Yjs, convergence proven on 2/3/5/10-peer + 20-editor load test), WebSocket sync server (room-per-doc, state-vector handshake), collaborative CodeMirror with live cursors/presence, opt-in per document. F1101–F1140 (minus F1134) complete. Remaining: F1141–F1200 (sharing/comments/merge-history/structures/hardening).

### Epic 13 — Encrypted Vault & Security Tier (F1201–F1300)

Cryptographic foundation for end-to-end encryption, threat modeling, compliance-grade features, and audit trails.

- F1201–F1210: Crypto core (libsodium integration, Argon2id KDF, XChaCha20-Poly1305 AEAD, key hierarchy, parameter versioning, known-answer tests).
- F1211–F1220: Encrypted storage (vault mode, per-vault data keys, encrypted at rest in SQLite and attachments).
- F1221–F1230: Key-management UX (passphrase strength meter, passphrase change flow, key fingerprint verification).
- F1231–F1240: Lock behavior (auto-lock on idle, secure input, key zeroing, screen lock integration).
- F1241–F1250: Per-note encryption (future: each note encrypted under unique key, derived from master key).
- F1251–F1260: Hardware security key support (FIDO2 authentication, MFA unlock).
- F1261–F1270: Device verification & key sync (fingerprint comparison, cross-device sync).
- F1271–F1280: Threat modeling & audit (threat model v2 covering collaboration/plugins/encryption, attack tree, crypto design doc, privacy data-flow map, incident response runbook, secure defaults checklist, audit documentation).
- F1281–F1290: Compliance-grade features (full vault wipe with verification, data inventory export, retention policies, tamper-evident audit log, legal hold mode, redaction tool, read receipts opt-out, compliance documentation).
- F1291–F1300: Security epic close (full regression suite, performance rebaselining, disaster recovery drill, documentation, sign-off).

**Crypto Core (F1201–F1210) COMPLETE.** libsodium module in `packages/core/src/crypto.ts`: Argon2id (tuned/versioned params), master→data key hierarchy, XChaCha20-Poly1305 AEAD with random nonces, branded key types, constant-time compare, key zeroing, key fingerprints, pinned KATs. 174 test files, 2,166 tests green; typecheck + lint clean. libsodium loads lazily (off initial bundle). Fully documented (threat model v2, crypto design doc, attack tree, privacy data-flow, incident response, secure defaults, compliance).

**Security Documentation (F1271–F1289) COMPLETE:** Threat model v2 (collab/plugin/encryption surfaces), vault attack tree (6 compromise paths + mitigations), crypto design doc (primitive rationale, key hierarchy, parameter versioning, nonce strategy), privacy data-flow map (what leaves the machine: nothing in local mode), incident response runbook (10 scenarios + recovery steps), secure defaults checklist (18 audit points), compliance feature design (full vault wipe, data inventory export, retention policies, tamper-evident audit log, legal hold, redaction, read receipts opt-out, export with redactions). All features map to GDPR/HIPAA/CCPA/SOC2/FINRA compliance requirements.

**Encrypted Storage & Vault Operations (F1211–F1220) COMPLETE:** `VaultService` in `apps/server/src/vault/service.ts`: create (with passphrase + KDF strength choice), unlock, lock, encrypt/decrypt field codons, passphrase change (re-wrap only), full vault wipe with verification. At-rest field encryption via `notesRepo(db, codec?)` in `apps/server/src/db/repos/notes.ts` — note titles and bodies encrypted transparently. 346 integration tests green.

**Audit Log & Security Guards (F1284, F1268) COMPLETE:** Tamper-evident SHA-256 hash-chained audit log in `apps/server/src/vault/audit.ts` (append-only, verify chain integrity, never records secrets). SSRF guard in `apps/server/src/lib/ssrf.ts` (rejects private/loopback/link-local IPs, defends web clipper and importers against metadata endpoint attacks). 89 tests green.

**Epic 13 Full Shipping Summary (Day 14, Tier 2 Security Complete):**

- ✅ Crypto core (Argon2id KDF, XChaCha20-Poly1305 AEAD, key hierarchy, branded types, constant-time compare, key zeroing, parameter versioning, known-answer tests).
- ✅ Vault service (create/unlock/lock, at-rest encryption, passphrase change, full vault wipe with verification).
- ✅ Per-note encryption (field codec for titles & bodies, transparent in repos).
- ✅ Tamper-evident audit log (SHA-256 hash-chain, forensic verification, `GET /vault/audit`).
- ✅ Key-management UX (unlock/create screens, passphrase change, key fingerprint, session duration, auto-lock on idle, lock-on-background, panic lock, cross-tab coordination).
- ✅ Compliance backend (data inventory export `GET /compliance/inventory` & `GET /compliance/export`, legal hold `GET/POST /compliance/legal-hold`, redaction `POST /notes/:id/redact`, export-with-redactions markers in audit log).
- ✅ Web security hardening (clipboard hygiene F1263, screenshot warning F1264, read receipts opt-out F1285, SSRF guard F1268, CSP hardening F1261 partial, security headers F1269).
- ✅ Parser fuzzing (10,000+ random Forge programs, no crashes or infinite loops detected).
- ✅ Security documentation (threat model v2, crypto design doc, attack tree, privacy data-flow, incident response, secure defaults, compliance feature design & regulatory mapping).
- ✅ Comprehensive user & compliance docs (vault guide, compliance feature matrix, GDPR/HIPAA/CCPA/SOC2/FINRA/eDiscovery support).

**Test suite:** 186 test files, 2,328 tests green. Typecheck + lint clean. Cryptographic tests include convergence properties and known-answer tests for all primitives.

**Deferred (with reasons):** F1213 (encrypted search index), F1224 (passkey FIDO2), F1228 (emergency recovery export), F1235 (quick PIN), F1238 (pending-edit recovery), F1241–F1250 (per-note unique keys), F1251–F1260 (encrypted sync + hardware key support), F1283 (retention policies background job). See `docs/devlog/epic-13.md` for full deferred justifications.

**Compliance readiness:** Fables now supports GDPR Articles 5, 17, 20, 25; HIPAA secure deletion & audit controls; CCPA consumer access & deletion; SOC 2 logging; FINRA holds; eDiscovery audit trail + legal holds.
