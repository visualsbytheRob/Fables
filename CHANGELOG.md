# Changelog

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
