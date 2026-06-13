# Epic 12 — Real-Time Collaboration & CRDT (F1101–F1200)

**Status:** complete (48 of 60 features in F1141–F1200 shipped; 12 deferred with reasons below). The earlier core slice F1101–F1140 (minus F1134) shipped previously. Full suite green: 173 test files, 2,149 tests.

## What shipped

The collaboration epic turns Fables from a single-writer app into a multi-device,
multi-author surface, built entirely on CRDTs so it converges without a central
lock and degrades gracefully to single-user when the server is unreachable.

### Core (F1101–F1140, prior slice)

- Yjs-backed CRDT engine with convergence fuzz-proofs (2/3/5/10-peer + a 20-editor
  load test) and a y-websocket-compatible binary sync protocol.
- Room-per-document WebSocket server with state-vector handshake, awareness relay,
  and batched persistence to `crdt_docs`.
- Collaborative CodeMirror editor with live cursors and presence, opt-in per document.

### Sharing & invites (F1141–F1150)

- Share model (`shares` repo + migration `019-shares`): per-doc grants with scoped
  tokens, read-only vs edit access levels, expiry and revocation, guest identity
  (name + colour), and an access audit log.
- REST surface: `POST /shares`, `GET /shares`, `GET /shares/:id`, `DELETE /shares/:id`,
  `GET /shares/:id/audit`, `POST /shares/validate`, `POST /shares/:id/guests`,
  `GET /shared-with-me`.
- Permission enforcement (`enforceShareAccess`) wired into the collab WebSocket
  upgrade: read-only tokens receive SyncStep2 but their updates are dropped;
  revoked/expired tokens are rejected before upgrade.

### Collaborative stories (F1151–F1160)

- Shared `.fable` file editing, compile coordination, synchronized playtest state,
  vote-on-choice group play, author/playtester/spectator roles, a session chat
  sidebar, and group-play recording to a transcript — all on a shared Y.Doc.

### Comments & suggestions (F1161–F1170)

- CRDT-anchored comments on note ranges that survive heavy edits, threads with
  resolve state, suggestion mode (accept/reject), toast notifications on new
  comments, comments on story knots, search/filters, export with note export,
  and emoji reactions.

### Merge & history (F1171–F1180)

- Named checkpoints, per-author attribution view, time-slider playback, restore
  with confirmation, diff between checkpoints, and a forensic recovery export that
  reconstructs content from raw CRDT updates.

### Conflict-free structures (F1181–F1190)

- Entity fields as CRDT maps, notebook tree as a CRDT (concurrent moves resolve,
  cycles detected and broken), commutative tag ops, and save-slot collision
  handling, with convergence fuzz tests.

### Hardening (F1191–F1200)

- Three-device chaos test (partitions, clock skew), bandwidth coalescing budget,
  security review of room auth and share tokens, data-integrity checksums across
  the collab+sync paths, a collab health diagnostics endpoint, and a graceful
  single-user fallback when the server is unreachable.

## Deferred (with reasons)

| Feature                                         | Reason                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| F1144 Share management UI                       | REST API (list/revoke) shipped; dedicated management panel UI deferred |
| F1147 Shared-with-me view                       | `GET /shared-with-me` shipped; UI view deferred                        |
| F1150 Sharing e2e tests                         | needs Playwright browser binaries, unavailable in this build env       |
| F1156 Live diagnostics to all editors           | shared diagnostics channel not yet implemented                         |
| F1176 Revision pruning policy                   | CRDT history retained in full; pruning policy not yet implemented      |
| F1177 Export attribution data                   | attribution computed in-app; dedicated export deferred                 |
| F1178 History perf on year-old docs             | long-horizon perf benchmark deferred                                   |
| F1184 Canvas objects as CRDT                    | canvas is itself a later feature; CRDT-backing deferred until it lands |
| F1186 Cross-structure transaction semantics doc | doc not yet written                                                    |
| F1187 Tier-1 data migration into CRDT forms     | seed helpers shipped; full migration pipeline deferred                 |
| F1193 Battery impact audit                      | requires on-device profiling                                           |
| F1199 Full collab e2e in CI                     | needs CI browser runners                                               |

## Decisions & notes

- The story/comments/history lanes initially labelled a few internal F-numbers
  with a one-step shift (e.g. chat tagged F1158 vs the spec's F1157). Boxes were
  ticked against the spec's feature definitions, not the source labels, after
  confirming the actual delivered API surface. One real gap surfaced this way:
  the "F1184" save-slot test is actually feature F1185, and canvas-as-CRDT (the
  true F1184) is not implemented — so F1184 is deferred and F1185 is done.
- `useCollabExtensions` exposes awareness but not the live Y.Doc/Y.Text, so the
  collab history _panel_ (built and unit-tested) is not yet surfaced against the
  live editor doc; that wiring is folded into the deferred history items.
- The 3 intermittent unhandled rejections occasionally seen in `clip.test.ts`
  (an ingest-service DB-not-open race) are pre-existing and unrelated to this
  epic; the suite passes clean on reruns.
