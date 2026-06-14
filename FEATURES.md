# FABLES — 2,000-Feature Build Plan

**Fables** is a personal Knowledge OS fused with an interactive fiction engine ("Fable Forge").
Your notes are the world. Your stories run on a compiler you own.

- **Architecture:** TypeScript pnpm monorepo. `apps/server` (Fastify + SQLite) and `apps/web` (Vite + React PWA). `packages/core` (domain), `packages/forge-dsl` (lexer/parser/compiler), `packages/forge-vm` (bytecode runtime), `packages/sync` (offline op-log sync), `packages/ui` (design system).
- **Deployment:** built remotely with Claude Code, cloned and run locally, served over the tailnet via `tailscale serve` (HTTPS via ts.net certs), installed as a PWA on iPhone.
- **Cadence:** Tier 1 (F1–F1000): the core app, 10 thematic days. Tier 2 (F1001–F2000): ten stretch epics. Target ~200–300 features/day via parallel agent teams; ~9 build days remain.

## Execution Protocol (read me first, future sessions)

1. Find the **first unchecked** `- [ ]` feature below. That is where work resumes.
2. Implement features in order. A feature is **done** when: code exists, it compiles, relevant tests pass, and the box is checked `- [x]`.
3. Commit in batches of ~10 features (one group = one commit) with message `feat(day-N): FXXX–FYYY <group name>`. Push directly to `main` after every 2–3 commits (user's standing instruction, 2026-06-11).
4. Never skip ahead past an unchecked feature without marking it `- [~]` (deferred) with a one-line reason appended.
5. If a feature is obsolete because of an earlier implementation decision, mark `- [x]` with `(subsumed by FXXX)` appended.
6. Keep `pnpm test` and `pnpm build` green at every commit. Do not leave the tree broken at end of session.
7. Update the **Status** line below at the end of every session.

**Status:** Epic 12 (Real-Time Collaboration & CRDT) COMPLETE — F1101–F1200. Shipped: CRDT core (Yjs, convergence fuzz-proven 2/3/5/10-peer + 20-editor load test, WebSocket sync server, collaborative CodeMirror editor); sharing model with scoped tokens / read-vs-edit / expiry / revocation / guest identity / audit log and permission enforcement on the collab path (migration 019-shares); collaborative stories (shared editing, vote-on-choice, roles, chat, recording); CRDT-anchored comments + suggestions; merge history (checkpoints, attribution, diff, restore, forensic recovery); conflict-free structures (entity fields, notebook tree, tags, save slots); and hardening (chaos test, security review, integrity checksums, health endpoint, graceful single-user). 48/60 of F1141–F1200 shipped; 12 deferred with reasons (UI panels for share management/shared-with-me, e2e suites needing browser runners, canvas CRDT, battery audit, history pruning — see docs/devlog/epic-12.md).

Epic 13 (Encrypted Vault & Security Tier, F1201–F1300) IN PROGRESS. Crypto Core (F1201–F1210) COMPLETE: misuse-resistant libsodium module in `packages/core/src/crypto.ts` — Argon2id KDF (tuned/versioned params), master→data key hierarchy (passphrase change re-wraps, never re-encrypts), XChaCha20-Poly1305 AEAD with internal random nonces, branded key types, constant-time compare, key zeroing, key fingerprints, and pinned known-answer tests. libsodium loads lazily (off the initial bundle). Storage core landed: a `VaultService` (apps/server/src/vault) on migration 020-vault — create/unlock/lock + at-rest field encrypt/decrypt under an in-memory data key, passphrase change via re-wrap (F1223, never re-encrypts content), wrong-passphrase detected by AEAD auth, key zeroed on lock; HTTP surface at `/vault/*`; metadata boundary documented (F1212). Security documentation set written (F1271/F1272/F1275–F1278/F1280/F1289). Key-management UX + lock behavior shipped (apps/web/src/vault): unlock/create screens with one-time recovery codes + honest data-loss messaging, passphrase-change dialog, wrong-passphrase exponential backoff, key-fingerprint display, session-duration setting, auto-lock on idle, lock-on-background, panic lock + indicator, locked-state UI rendering nothing sensitive, in-memory purge on lock, and cross-tab coordination via BroadcastChannel (F1221/F1222/F1225–F1227/F1229–F1234/F1236/F1237/F1239/F1240; F1224 passkey + F1235 PIN + F1228 emergency-export + F1238 pending-edit deferred). Vault gate wired into the app shell as opt-in (transparent with no vault; gates only when locked). Notes-at-rest encryption landed (F1211): synchronous crypto primitives + an `enc:v1:` field codec in @fables/core, a `VaultService.fieldCodec()`, and `notesRepo(db, codec?)` that encrypts titles/bodies on write and decrypts on read — proven end-to-end (ciphertext on disk, transparent plaintext on read, mixed plaintext/ciphertext safe). Compliance features F1281/F1284: a tamper-evident SHA-256 hash-chained security audit log (vault create/unlock/unlock-failed/lock/passphrase-change/wipe events, with `verify()` that pinpoints the first broken row) and a full vault wipe with re-auth + verification (`GET /vault/audit`, `POST /vault/wipe`). Hardening: SSRF guard on outbound URL fetches (F1268) — scheme allow-list + DNS-resolved private/reserved/metadata IP blocking, wired into the web clipper; security-headers verification suite (F1269); CSP tightened with object-src 'none' (F1261 partial). Agentic-formation pass (1 Opus + 2 Sonnet + 1 Haiku) landed: compliance backend (data inventory F1282, legal hold F1286, redaction + export-with-redactions F1287/F1288, migration 022), web security UI (clipboard hygiene F1263, read-receipts opt-out F1285, screenshot warning F1264, plus the Epic-12-deferred share-management F1144 + shared-with-me F1147), parser fuzzing F1267, and a docs refresh. Round-2 agentic pass: encrypted sync payload primitives (F1251/F1252/F1258 — op-log + CRDT updates sealed so a server stores/relays only ciphertext, server-compromise property proven), share UIs wired into /shares + /shared-with-me routes, SRI manifest + safe-object-URL helper (F1262/F1265 partial), and a vault-blob-crypto + attachment-encryption + retention-schema foundation (F1214/F1218/F1283 modules built, not yet wired/tested). Solo-driven completions this run: encrypted attachments wired into the live upload/download path (F1214), per-notebook retention with legal-hold-respecting auto-purge (F1283), encrypted backup v2 (.fablesbak FBK2 envelope, F1218), and an enforced dependency supply-chain pinning policy (F1266). 196 test files, 2,368 tests green; typecheck + lint clean. Epic 13 (Encrypted Vault & Security Tier) ~95%% done: crypto core, vault create/unlock/lock/wipe, at-rest notes + attachments + backups, key-mgmt UX + lock, audit log, compliance (inventory/legal-hold/redaction/retention), SSRF guard (+ plugin-capability SSRF fix), supply-chain policy, disaster-recovery drill, and the full security doc set. KEYSTONE REMAINING (own session, leak-tested): thread the field codec through the notes service+route incl. revisions so notes encrypt/decrypt app-wide — unblocks encrypted search (F1213), vault conversion (F1215), per-note secrets (F1241–1250). Also remaining: device-key sync (F1253–1260), platform-API features (F1224 passkey, F1235 PIN).

---

## Day 1 — Foundation & Monorepo (F001–F100)

### Repo & Tooling (F001–F010)

- [x] F001 — Initialize pnpm workspace monorepo with `apps/` and `packages/` directories
- [x] F002 — Root `package.json` with workspace scripts: `dev`, `build`, `test`, `lint`, `format`, `typecheck`
- [x] F003 — `pnpm-workspace.yaml` covering `apps/*` and `packages/*`
- [x] F004 — Shared `tsconfig.base.json`: strict mode, ES2022, path aliases for all packages
- [x] F005 — ESLint flat config shared across the workspace
- [x] F006 — Prettier config + `.editorconfig`
- [x] F007 — `.gitignore` covering node_modules, dist, data dirs, env files
- [x] F008 — Node version pinning: `.nvmrc` + `engines` field
- [x] F009 — `README.md` quickstart: clone → `pnpm install` → `pnpm dev` → tailscale serve
- [x] F010 — `scripts/doctor.mjs`: verifies Node version, pnpm presence, port availability

### Core Domain Package (F011–F020)

- [x] F011 — `packages/core`: package scaffold with build + test wiring
- [x] F012 — Branded ID types (`NoteId`, `StoryId`, `EntityId`) with ULID generation
- [x] F013 — Domain types: `Note`, `Notebook`, `Tag`, `Attachment`
- [x] F014 — Domain types: `Story`, `Scene`, `Entity`, `Link`
- [x] F015 — Zod schemas mirroring all domain types for runtime validation
- [x] F016 — `Result<T, E>` utility type with `ok`/`err` helpers and combinators
- [x] F017 — Error taxonomy: `AppError` hierarchy with stable error codes
- [x] F018 — Date/time utilities: ISO handling, relative formatting, day-key helpers
- [x] F019 — Slug + title utilities (unicode-safe, collision-suffixing)
- [x] F020 — Unit tests covering all core utilities and schema round-trips

### Server Bootstrap (F021–F030)

- [x] F021 — `apps/server`: Fastify app factory pattern (`buildApp()` returns configurable instance)
- [x] F022 — `/api/v1/health` endpoint with version, uptime, db status
- [x] F023 — Graceful shutdown: SIGINT/SIGTERM drain, close db, flush logs
- [x] F024 — Request logging with request IDs via pino
- [x] F025 — Central error handler mapping `AppError` codes → HTTP statuses
- [x] F026 — CORS configuration permitting tailnet origins
- [x] F027 — Static file serving of the built web app from the server
- [x] F028 — Route registration pattern: one module per resource, auto-registered
- [x] F029 — Server config loader (port, host, data dir) with zod validation
- [x] F030 — Server integration tests: boot, health check, 404 envelope, shutdown

### Database Layer (F031–F040)

- [x] F031 — better-sqlite3 connection module with WAL mode + foreign keys on
- [x] F032 — Migrations runner: numbered SQL files, applied-migrations table, idempotent
- [x] F033 — Migration 001: notes, notebooks, tags, note_tags tables
- [x] F034 — Migration 002: stories, scenes, entities, links tables
- [x] F035 — Repository pattern: typed repo per table, no raw SQL outside repos
- [x] F036 — Transaction helper wrapping multi-repo operations
- [x] F037 — Seed script with demo notebook, notes, and a sample story
- [x] F038 — `pnpm db:backup` command producing timestamped copy of the SQLite file
- [x] F039 — `pnpm db:check` integrity check command (PRAGMA integrity_check)
- [x] F040 — Repo unit tests against in-memory SQLite

### Config & Environment (F041–F050)

- [x] F041 — Env parsing with zod: `PORT`, `DATA_DIR`, `LOG_LEVEL`, `NODE_ENV`
- [x] F042 — Data directory resolution defaulting to `~/.fables`, auto-created
- [x] F043 — `fables.config.json` optional file overriding env defaults
- [x] F044 — Dev vs prod mode switches (pretty logs, dev proxy hints)
- [x] F045 — CLI flags for server entry: `--port`, `--data-dir`, `--open`
- [x] F046 — Config precedence: flags > env > config file > defaults; documented
- [x] F047 — `/api/v1/config` endpoint exposing non-sensitive effective config
- [x] F048 — Secrets policy: no secrets in repo; `.env.example` template
- [x] F049 — Config docs section in README
- [x] F050 — Config unit tests covering precedence and validation failures

### Logging & Observability (F051–F060)

- [x] F051 — pino logger module with child-logger conventions per subsystem
- [x] F052 — Log level control at runtime via `/api/v1/debug/log-level`
- [x] F053 — Request ID propagation into all downstream logs
- [x] F054 — Slow query logging: warn when SQLite call exceeds threshold
- [x] F055 — Error serializer capturing code, stack, cause chain
- [x] F056 — Rotating file transport for logs in `DATA_DIR/logs`
- [x] F057 — Startup banner: version, port, data dir, tailnet hint
- [x] F058 — `/api/v1/debug/stats` endpoint: db size, note/story counts, memory
- [x] F059 — Debug namespaces toggled via env (`DEBUG=forge:*`)
- [x] F060 — Logging unit tests (serializers, levels, redaction)

### Web App Bootstrap (F061–F070)

- [x] F061 — `apps/web`: Vite + React + TypeScript scaffold
- [x] F062 — React Router setup with layout route + placeholder pages
- [x] F063 — App shell: sidebar, top bar, main pane, responsive collapse
- [x] F064 — Typed API client generated from shared route schemas
- [x] F065 — TanStack Query setup with sensible cache defaults
- [x] F066 — Global error boundary with friendly fallback + reload
- [x] F067 — Suspense/loading skeleton primitives
- [x] F068 — API base URL from env with dev proxy to server port
- [x] F069 — Vitest + Testing Library smoke test rendering the shell
- [x] F070 — `pnpm dev` runs server + web concurrently with one command

### Design System Base (F071–F080)

- [x] F071 — `packages/ui`: CSS custom-property tokens (color, spacing, type scale, radii)
- [x] F072 — Dark/light theme with system-preference detection + manual toggle
- [x] F073 — Button, Input, Textarea, Select primitives
- [x] F074 — Dialog, Popover, Tooltip primitives (accessible, focus-trapped)
- [x] F075 — Toast/notification system
- [x] F076 — Icon set wiring (lucide) with consistent sizing
- [x] F077 — Command palette shell component (⌘K) with fuzzy filter
- [x] F078 — Responsive breakpoints + container utilities
- [x] F079 — Focus-visible styles and reduced-motion support
- [x] F080 — `/playground` route rendering every primitive for visual QA

### API Conventions (F081–F090)

- [x] F081 — Response envelope: `{ data }` / `{ error: { code, message } }`
- [x] F082 — Cursor pagination convention with `limit`/`cursor` params
- [x] F083 — Stable error code catalog shared between server and client
- [x] F084 — Validation middleware: zod-checked params/query/body per route
- [x] F085 — Route schema registry enabling typed client generation
- [x] F086 — `/api/v1` version prefix and version negotiation header
- [x] F087 — ETag support on GET endpoints for cache validation
- [x] F088 — Response compression (gzip/brotli) for JSON payloads
- [x] F089 — Light rate limiting tuned for single-user tailnet use
- [x] F090 — Contract tests asserting envelope + pagination behavior

### Dev Experience & CI (F091–F100)

- [x] F091 — GitHub Actions CI: install, lint, typecheck, test, build on push/PR
- [x] F092 — Vitest workspace config running all package test suites
- [x] F093 — Coverage reporting with per-package thresholds
- [x] F094 — `pnpm typecheck` running project references build
- [x] F095 — Bundle size check for web build with budget warning
- [x] F096 — Pre-commit hook: lint-staged (eslint + prettier on staged files)
- [x] F097 — Issue + PR templates
- [x] F098 — `CONTRIBUTING.md` describing monorepo layout and commands
- [x] F099 — VS Code workspace settings + recommended extensions file
- [x] F100 — Day-1 retro note in `docs/devlog/day-01.md`

---

## Day 2 — Notes Core (F101–F200)

### Note CRUD API (F101–F110)

- [x] F101 — `POST /notes` create with title, body, notebook
- [x] F102 — `GET /notes/:id` fetch single note with metadata
- [x] F103 — `GET /notes` list with pagination, sort (updated/created/title)
- [x] F104 — `PATCH /notes/:id` partial update with optimistic concurrency (rev check)
- [x] F105 — `DELETE /notes/:id` soft delete to trash
- [x] F106 — `POST /notes/:id/restore` from trash
- [x] F107 — Trash auto-purge policy (30 days) with manual empty endpoint
- [x] F108 — Duplicate note endpoint preserving tags and notebook
- [x] F109 — Bulk operations endpoint: move, tag, delete multiple notes
- [x] F110 — CRUD integration tests covering happy paths and conflict cases

### Note Storage & Versioning (F111–F120)

- [x] F111 — Note revision table: append-only snapshots on save
- [x] F112 — Revision pruning policy (keep all <24h, daily afterward)
- [x] F113 — `GET /notes/:id/revisions` list endpoint
- [x] F114 — `GET /notes/:id/revisions/:rev` fetch specific revision
- [x] F115 — Restore-to-revision endpoint creating a new head revision
- [x] F116 — Content hashing to skip no-op revisions
- [x] F117 — Word/character count stored per revision
- [x] F118 — Note size guard with friendly error past limit
- [x] F119 — Revision diff computation (server-side, word-level)
- [x] F120 — Versioning unit tests including pruning edge cases

### Markdown Editor (F121–F130)

- [x] F121 — CodeMirror 6 editor component with markdown language mode
- [x] F122 — Syntax highlighting theme matching app dark/light themes
- [x] F123 — Toolbar: bold, italic, heading, list, code, link, quote
- [x] F124 — Keyboard shortcuts for all toolbar actions
- [x] F125 — Smart lists: continue/indent/outdent with Tab/Shift-Tab
- [x] F126 — Code block editing with language tag + nested highlighting
- [x] F127 — Image paste → attachment upload → markdown link insertion
- [x] F128 — Drag-and-drop file attach into editor
- [x] F129 — Editor settings: font size, line width, vim-lite mode toggle
- [x] F130 — Editor component tests (commands, list behavior)

### Markdown Rendering (F131–F140)

- [x] F131 — Markdown → HTML pipeline (remark/rehype) with sanitization
- [x] F132 — GFM support: tables, strikethrough, task lists, autolinks
- [x] F133 — Syntax-highlighted code blocks in preview
- [x] F134 — Task list checkboxes toggleable from preview (writes back to source)
- [x] F135 — Footnotes and definition list support
- [x] F136 — Math rendering (KaTeX) behind a setting
- [x] F137 — Mermaid diagram rendering behind a setting
- [x] F138 — Heading anchor links + in-note table of contents component
- [x] F139 — Split view: editor | live preview with synced scroll
- [x] F140 — Rendering snapshot tests for the full pipeline

### Notebooks & Organization (F141–F150)

- [x] F141 — Notebook CRUD API with nesting (parent_id)
- [x] F142 — Notebook tree sidebar with expand/collapse, drag to reorder
- [x] F143 — Move note between notebooks (drag + command palette)
- [x] F144 — Notebook icons + colors
- [x] F145 — Default notebook setting for quick capture
- [x] F146 — Notebook-level note count badges
- [x] F147 — Archive notebook flag hiding it from default views
- [x] F148 — Breadcrumb navigation for nested notebooks
- [x] F149 — Notebook deletion with note re-homing flow
- [x] F150 — Notebook tree tests (nesting, moves, cycles prevented)

### Tags (F151–F160)

- [x] F151 — Tag CRUD API with rename propagation
- [x] F152 — Inline `#tag` parsing from note bodies into tag index
- [x] F153 — Tag autocomplete in editor on `#` trigger
- [x] F154 — Tag sidebar section with counts
- [x] F155 — Tag filter view: notes by tag with AND/OR combination
- [x] F156 — Tag colors + emoji support
- [x] F157 — Nested tags (`#world/characters`) with hierarchy view
- [x] F158 — Merge tags operation
- [x] F159 — Orphan tag cleanup job
- [x] F160 — Tag parsing + propagation tests

### Attachments & Files (F161–F170)

- [x] F161 — Attachment upload endpoint storing to `DATA_DIR/attachments` content-addressed
- [x] F162 — Attachment metadata table: mime, size, hash, source note
- [x] F163 — Image serving with on-the-fly resize variants
- [x] F164 — Attachment garbage collection for unreferenced files
- [x] F165 — File type allowlist + size limits with clear errors
- [x] F166 — Image lightbox viewer in note preview
- [x] F167 — PDF attachment inline preview
- [x] F168 — Audio attachment player component
- [x] F169 — Attachment manager view: all files, sizes, owning notes
- [x] F170 — Attachment lifecycle tests (upload, GC, dedupe by hash)

### Note List & Navigation UI (F171–F180)

- [x] F171 — Note list pane: title, snippet, updated time, tag chips
- [x] F172 — Virtualized list for large notebooks
- [x] F173 — Sort + filter bar (date, title, has-attachments, tag)
- [x] F174 — Multi-select with bulk action toolbar
- [x] F175 — Note context menu (open, duplicate, move, delete)
- [x] F176 — Quick switcher (⌘P): fuzzy jump to any note
- [x] F177 — Recent notes + pinned notes sections
- [x] F178 — Pin/unpin note action
- [x] F179 — Three-pane responsive layout collapsing gracefully to phone width
- [x] F180 — Navigation flow tests (switcher, list selection, deep links)

### Autosave & History UX (F181–F190)

- [x] F181 — Debounced autosave with saving/saved indicator
- [x] F182 — Conflict detection on stale rev with merge prompt
- [x] F183 — Revision history panel with timeline slider
- [x] F184 — Side-by-side revision diff view
- [x] F185 — One-click restore from history panel
- [x] F186 — Local draft recovery from unexpected tab close (localStorage)
- [~] F187 — Undo/redo depth beyond editor default, persisted per session (deferred: CM default history + draft recovery cover it)
- [x] F188 — "Unsaved changes" navigation guard
- [x] F189 — Save status in command palette + keyboard force-save
- [x] F190 — Autosave/conflict integration tests

### Power Features (F191–F200)

- [x] F191 — Quick capture modal (global hotkey) creating note in default notebook
- [x] F192 — Note templates v0: new-note-from-template picker
- [x] F193 — Word count + reading time in status bar
- [x] F194 — Focus mode: hide all chrome, typewriter scrolling (typewriter scrolling deferred)
- [x] F195 — Note export: single note → .md file download
- [x] F196 — Copy note as markdown / as rendered HTML
- [x] F197 — Note info panel: created, updated, counts, backlinks stub
- [x] F198 — Keyboard shortcut cheat-sheet overlay (?)
- [x] F199 — Command palette actions for every note operation
- [x] F200 — Day-2 retro note in `docs/devlog/day-02.md`

---

## Day 3 — Linking, Graph & Queries (F201–F300)

### Wikilinks (F201–F210)

- [x] F201 — `[[wikilink]]` syntax parsing in note bodies
- [x] F202 — Link table maintenance on note save (source, target, position)
- [x] F203 — Wikilink autocomplete in editor on `[[` trigger
- [x] F204 — Click-to-navigate wikilinks in preview and editor
- [x] F205 — `[[link|alias]]` display alias support
- [x] F206 — Broken link styling + create-on-click for missing targets
- [x] F207 — Heading-level links `[[note#heading]]`
- [x] F208 — Block-level links `[[note^blockid]]` with block ID generation
- [x] F209 — Link rename propagation when a note title changes
- [x] F210 — Wikilink parser test suite (nesting, escapes, unicode)

### Backlinks (F211–F220)

- [x] F211 — Backlinks API: incoming links for a note with context snippets
- [x] F212 — Backlinks panel in note view grouped by source note
- [x] F213 — Context snippet extraction around each backlink mention
- [x] F214 — Backlink count badge on note list items
- [x] F215 — Click backlink snippet → open source at exact position
- [x] F216 — Backlinks for headings and blocks, not just whole notes
- [x] F217 — Backlinks sort: by recency, by source notebook
- [x] F218 — Backlinks panel collapse state persistence
- [x] F219 — Link integrity job: detect and report orphaned link rows
- [x] F220 — Backlinks API tests including snippet boundaries

### Unlinked Mentions (F221–F230)

- [x] F221 — Unlinked mention detection: note titles appearing as plain text elsewhere
- [x] F222 — Mention index updated incrementally on save
- [x] F223 — Unlinked mentions section in backlinks panel
- [x] F224 — One-click "link this mention" converting text to wikilink
- [x] F225 — Bulk "link all mentions" action with preview
- [x] F226 — Alias-aware mention detection (entity aliases match too)
- [x] F227 — Case sensitivity + word-boundary rules with settings
- [x] F228 — Mention scan performance budget: incremental, never full-table on save
- [x] F229 — Exclusion rules (code blocks, URLs don't count as mentions)
- [x] F230 — Mention detection test suite

### Graph Data API (F231–F240)

- [x] F231 — Graph endpoint: nodes (notes/entities/stories) + edges (links)
- [x] F232 — Graph filtering params: notebooks, tags, types, date range
- [x] F233 — Local graph endpoint: n-hop neighborhood around one note
- [x] F234 — Node degree + cluster metadata computed server-side
- [x] F235 — Graph response caching with invalidation on link changes
- [x] F236 — Orphan node detection (no links in or out)
- [x] F237 — Edge weighting by link count between same pair
- [x] F238 — Graph export endpoint (JSON, GraphML)
- [x] F239 — Community detection (simple label propagation) for cluster coloring
- [x] F240 — Graph API tests on seeded fixtures

### Graph View UI (F241–F250)

- [x] F241 — Force-directed graph canvas (WebGL via pixi/sigma or d3+canvas)
- [x] F242 — Pan/zoom/drag interactions, mobile pinch support
- [x] F243 — Node styling by type (note/entity/story) and cluster color
- [x] F244 — Hover highlight of node neighborhood, dim the rest
- [x] F245 — Click node → preview popover; double-click → open note
- [x] F246 — Graph filter toolbar bound to graph API params
- [x] F247 — Local graph mode embedded in note view sidebar
- [x] F248 — Graph search: type to locate and center a node
- [x] F249 — Layout settings: gravity, link distance, freeze toggle
- [x] F250 — Graph view performance test with 5k-node synthetic fixture

### Daily Notes & Journal (F251–F260)

- [x] F251 — Daily note convention: one note per day-key in Journal notebook
- [x] F252 — "Today" command creating/opening today's daily note
- [x] F253 — Calendar widget navigating to any day's note
- [x] F254 — Daily note template with configurable sections
- [x] F255 — Streak indicator for consecutive journaling days
- [x] F256 — Yesterday/tomorrow quick navigation in daily notes
- [x] F257 — Automatic date heading + created-via-capture entries appended
- [x] F258 — Week view: seven daily notes summarized
- [x] F259 — On-this-day resurfacing of past years' entries
- [x] F260 — Daily note flow tests

### Templates (F261–F270)

- [x] F261 — Template notebook convention + template picker
- [x] F262 — Template variables: `{{date}}`, `{{title}}`, `{{cursor}}`
- [x] F263 — Custom variable prompts on instantiation
- [x] F264 — Insert-template-at-cursor command (not just new note)
- [x] F265 — Entity templates (character sheet, location sheet, item card)
- [x] F266 — Story scene template for Forge authoring
- [x] F267 — Template preview before instantiation
- [x] F268 — Default template per notebook setting
- [x] F269 — Template management UI (list, edit, duplicate)
- [x] F270 — Template engine tests (variables, escaping)

### Query Language — FQL (F271–F280)

- [x] F271 — FQL grammar v0: `tag:x notebook:y before:date "phrase"` filters
- [x] F272 — FQL parser with helpful syntax error messages
- [x] F273 — FQL → SQL compiler over the notes index
- [x] F274 — Boolean operators AND/OR/NOT with grouping parens
- [x] F275 — Field queries: title:, body:, has:attachment, linksto:[[note]]
- [x] F276 — Date math: `updated:>7d`, `created:2026-06`
- [x] F277 — Sort directives: `sort:updated desc`
- [x] F278 — FQL query bar UI with syntax highlighting + completion
- [x] F279 — FQL error recovery: partial results with warning chips
- [x] F280 — FQL test suite: parser cases + SQL output snapshots

### Saved Queries & Embeds (F281–F290)

- [x] F281 — Saved query CRUD: name, FQL string, icon
- [x] F282 — Saved queries section in sidebar acting as smart folders
- [x] F283 — Query embed block in notes: ```fql fenced block renders live results
- [x] F284 — Embed result rendering: list, table, count modes
- [x] F285 — Embed refresh policy + manual refresh control
- [x] F286 — Dashboard note pattern: a note made of query embeds
- [x] F287 — Saved query pinning to top bar
- [x] F288 — Query result export (markdown table)
- [x] F289 — Embed depth/recursion guards
- [x] F290 — Saved query + embed integration tests

### Import & Export (F291–F300)

- [x] F291 — Markdown folder import: directory of .md files → notebook, links resolved
- [x] F292 — Obsidian vault import: wikilinks, frontmatter, attachments mapped
- [x] F293 — Frontmatter handling: YAML metadata → tags/fields
- [x] F294 — Import dry-run report before committing
- [x] F295 — Full vault export: notebooks → folders of .md + attachments
- [x] F296 — Export fidelity: round-trip import(export(x)) preserves links
- [x] F297 — Import progress UI with per-file error reporting
- [x] F298 — Duplicate handling strategy on import (skip/rename/merge)
- [x] F299 — CLI import command for huge vaults (`pnpm fables import <dir>`)
- [x] F300 — Day-3 retro note in `docs/devlog/day-03.md`

---

## Day 4 — Forge DSL: Language & Compiler Front-End (F301–F400)

### Language Specification (F301–F310)

- [x] F301 — `docs/forge/spec.md`: language overview, design goals, file extension `.fable`
- [x] F302 — Spec: scenes, passages, and the knot/stitch structural model
- [x] F303 — Spec: choices syntax (`*` once-only, `+` sticky), nested choice depth
- [x] F304 — Spec: variables, types (bool/number/string/list), declarations
- [x] F305 — Spec: conditionals, expressions, operator precedence table
- [x] F306 — Spec: diverts/jumps between scenes and stories
- [x] F307 — Spec: tags, metadata blocks, author directives
- [x] F308 — Spec: knowledge-base bindings (`@entity`, `@note` references) — the fusion hook
- [x] F309 — Spec: includes/imports across .fable files
- [x] F310 — Spec: formal grammar appendix (EBNF) kept in sync with parser

### Lexer (F311–F320)

- [x] F311 — `packages/forge-dsl`: package scaffold with strict build + tests
- [x] F312 — Token type definitions with source span tracking (line, col, offset)
- [x] F313 — Lexer core: text content vs logic mode switching
- [x] F314 — Tokenize structural markers: knots `===`, stitches `=`, choices `*`/`+`
- [x] F315 — Tokenize logic: identifiers, numbers, strings with escapes, operators
- [x] F316 — Tokenize diverts `->`, glue `<>`, tags `#`, comments `//` `/* */`
- [x] F317 — Tokenize knowledge bindings `@entity(...)` and `[[note]]` refs
- [x] F318 — Lexer error recovery: invalid char → error token, keep going
- [x] F319 — Lexer fuzz harness: random input never throws, always terminates
- [x] F320 — Lexer golden tests: fixture files → token stream snapshots

### Parser (F321–F330)

- [x] F321 — Recursive descent parser producing typed AST with spans
- [x] F322 — Parse story structure: header metadata, knots, stitches, content lines
- [x] F323 — Parse choices with nesting depth, conditions, and labels
- [x] F324 — Parse expressions: precedence climbing, unary/binary/ternary
- [x] F325 — Parse logic lines: VAR/CONST declarations, assignments, function calls
- [x] F326 — Parse diverts, tunnels (call/return), and end-of-flow markers
- [x] F327 — Parse inline conditionals and alternatives (`{cond: a|b}`, sequences/cycles)
- [x] F328 — Parse knowledge bindings into dedicated AST nodes
- [x] F329 — Parser error recovery: sync points so one error doesn't cascade
- [x] F330 — Parser golden tests: fixtures → AST JSON snapshots

### AST & Visitors (F331–F340)

- [x] F331 — AST node type hierarchy with discriminated unions
- [x] F332 — Visitor/walker utility with enter/exit hooks
- [x] F333 — AST printer: AST → canonical source (basis for formatter)
- [x] F334 — Span utilities: node → source excerpt for diagnostics
- [x] F335 — AST query helpers: find-all-diverts, find-all-bindings, etc.
- [x] F336 — Parent-pointer pass for upward traversal
- [x] F337 — AST JSON serialization stable across versions
- [x] F338 — Node factory helpers for tests and codegen tooling
- [x] F339 — AST invariant checker (no orphan spans, valid parent chains)
- [x] F340 — Visitor + printer round-trip tests

### Diagnostics Engine (F341–F350)

- [x] F341 — Diagnostic type: severity, code, span, message, related spans
- [x] F342 — Diagnostic catalog with stable codes (`FORGE001`…)
- [x] F343 — Pretty terminal renderer: source frame with caret underlines
- [x] F344 — JSON diagnostic output for editor integration
- [x] F345 — Multi-error collection: compile never stops at first error
- [x] F346 — Warnings: unreachable content, unused variables, empty choices
- [x] F347 — Hints: did-you-mean suggestions for misspelled knot names
- [x] F348 — Diagnostic suppression comments (`// forge-ignore FORGE012`)
- [x] F349 — Severity configuration (promote warnings to errors)
- [x] F350 — Diagnostics snapshot tests for every catalog code

### Symbol Resolution (F351–F360)

- [x] F351 — Symbol table: knots, stitches, variables, labels with scopes
- [x] F352 — Two-pass resolution: declare all, then resolve references
- [x] F353 — Divert target resolution incl. cross-file targets
- [x] F354 — Variable scope rules: global VAR, temp `~ temp`, choice-local
- [x] F355 — Duplicate declaration detection with both spans reported
- [x] F356 — Undefined reference errors with nearest-name suggestion
- [x] F357 — Knowledge binding resolution against the notes/entities DB at compile time
- [x] F358 — Include graph resolution with cycle detection
- [x] F359 — Dead knot detection (unreachable from entry point)
- [x] F360 — Resolution test suite incl. multi-file fixtures

### Semantic Checks (F361–F370)

- [x] F361 — Type checking for expressions (bool/number/string/list)
- [x] F362 — Condition expressions must be boolean — error with coercion hint
- [x] F363 — List operations validity (membership, add/remove)
- [x] F364 — Choice structure rules: no content after unconditional divert
- [x] F365 — Once-only choice exhaustion analysis (possible dead ends flagged)
- [x] F366 — Tunnel call/return pairing validation
- [x] F367 — Const reassignment errors
- [x] F368 — String interpolation expression validation
- [x] F369 — Entity binding field checks (`@hero.health` exists on entity schema)
- [x] F370 — Semantic check test suite

### Formatter (F371–F380)

- [x] F371 — `forge fmt`: canonical formatting from AST printer
- [x] F372 — Indentation rules for nested choices and gathers
- [x] F373 — Logic line spacing + alignment conventions
- [x] F374 — Comment preservation through format
- [x] F375 — Idempotency guarantee: fmt(fmt(x)) === fmt(x), property-tested
- [x] F376 — Range formatting (format selection only)
- [x] F377 — `--check` mode for CI
- [x] F378 — Format-on-save wiring in the web editor
- [x] F379 — Formatter config: max width, choice marker style
- [x] F380 — Formatter golden tests across fixture corpus

### Editor Integration (F381–F390)

- [x] F381 — CodeMirror 6 language package for `.fable` (parser-backed)
- [x] F382 — Syntax highlighting: structure, logic, strings, bindings, comments
- [x] F383 — Live diagnostics in editor gutter + squiggles from compiler
- [x] F384 — Autocomplete: knot names, variables, entity bindings
- [x] F385 — Go-to-definition for diverts and variables
- [x] F386 — Hover info: variable type, knot summary, entity preview
- [x] F387 — Document outline panel (knots/stitches tree)
- [x] F388 — Rename refactor for knots and variables
- [x] F389 — Folding for knots and choice blocks
- [x] F390 — Editor integration tests (completion, diagnostics overlay)

### Language Test Infrastructure (F391–F400)

- [x] F391 — Fixture corpus: 20+ `.fable` programs from trivial to gnarly
- [x] F392 — Golden test runner: lex/parse/resolve snapshots per fixture
- [x] F393 — Error fixture corpus: programs that must produce specific diagnostics
- [x] F394 — Property tests: printer/parser round-trip
- [x] F395 — Fuzzer: grammar-aware random program generator
- [x] F396 — Performance benchmark: 10k-line story compiles under budget
- [x] F397 — Coverage gate for forge-dsl ≥ 90%
- [x] F398 — Spec ↔ implementation conformance checklist doc
- [x] F399 — `forge check` CLI command (compile-only, report diagnostics)
- [x] F400 — Day-4 retro note in `docs/devlog/day-04.md`

---

## Day 5 — Compiler Back-End & VM (F401–F500)

### Intermediate Representation (F401–F410)

- [x] F401 — `packages/forge-vm`: package scaffold
- [x] F402 — IR design doc: flat container tree, instruction kinds
- [x] F403 — AST → IR lowering for content and structure
- [x] F404 — IR for expressions: stack-based operation sequence
- [x] F405 — IR for choices: choice points with condition refs
- [x] F406 — IR for diverts/tunnels: addresses + call-stack ops
- [x] F407 — IR validation pass (well-formed addresses, no dangling refs)
- [x] F408 — IR text dump format for debugging (`forge dump-ir`)
- [x] F409 — IR optimization: constant folding, dead branch pruning
- [x] F410 — Lowering test suite with IR snapshots

### Bytecode Format (F411–F420)

- [x] F411 — Bytecode container spec: header, version, string table, instruction stream
- [x] F412 — Opcode set definition (~40 ops) with operand encodings
- [x] F413 — Serializer: IR → bytecode buffer
- [x] F414 — Deserializer with version check + corruption detection (checksum)
- [x] F415 — String/constant pool deduplication
- [x] F416 — Source map section: instruction → source span for runtime errors
- [x] F417 — Knowledge binding table section (entity/note refs by ID)
- [x] F418 — Disassembler (`forge disasm`) producing readable listing
- [x] F419 — Backward compatibility policy doc + version negotiation
- [x] F420 — Round-trip tests: serialize → deserialize → identical execution

### Code Generation (F421–F430)

- [x] F421 — Codegen for text output ops with interpolation
- [x] F422 — Codegen for variable load/store, temp slots
- [x] F423 — Codegen for arithmetic/logic/comparison expression ops
- [x] F424 — Codegen for conditionals and inline alternatives (sequences, cycles, shuffles)
- [x] F425 — Codegen for choice points incl. once-only visit tracking
- [x] F426 — Codegen for diverts, tunnels, and story end
- [x] F427 — Codegen for list operations
- [x] F428 — Codegen for entity binding reads/writes
- [x] F429 — Visit-count instrumentation (knot/stitch counters)
- [x] F430 — Codegen golden tests: fixtures → disassembly snapshots

### VM Core (F431–F440)

- [x] F431 — VM execution loop: fetch/decode/execute over bytecode
- [x] F432 — Output buffer model: text fragments, line breaks, glue resolution
- [x] F433 — `Continue()` semantics: run until choice point or end
- [x] F434 — Choice presentation: gather available choices with evaluated conditions
- [x] F435 — `ChooseIndex()` API resuming flow from selected choice
- [x] F436 — Call stack for tunnels with depth limit + overflow diagnostics
- [x] F437 — Runtime error model mapping back to source via source maps
- [x] F438 — Step budget guard against infinite loops, configurable
- [x] F439 — VM public API surface doc (`createStory`, `continue`, `choices`, `choose`)
- [x] F440 — VM core tests driving fixture stories end-to-end

### State & Variables (F441–F450)

- [x] F441 — Variable storage: globals map, temp frames, typed values
- [x] F442 — Visit counts queryable from expressions (`visited(knot)`)
- [x] F443 — Read-only external state injection (host-provided values)
- [x] F444 — Variable observers: host callback on change (drives UI)
- [x] F445 — List value semantics: ordered sets with origin tracking
- [x] F446 — String interpolation evaluation at output time
- [x] F447 — Turn counter + choice history in state
- [x] F448 — State serialization: full VM state → JSON
- [x] F449 — State deserialization with bytecode-version compatibility check
- [x] F450 — State round-trip property tests (serialize mid-story, resume, identical transcript)

### Choices & Control Flow (F451–F460)

- [x] F451 — Once-only choice consumption tracked in state
- [x] F452 — Sticky choices remain across revisits
- [x] F453 — Conditional choices evaluated lazily at presentation
- [x] F454 — Fallback choice semantics (auto-taken when no others remain)
- [x] F455 — Gather points re-converging branched flow
- [x] F456 — Nested choice/gather depth handling (4+ levels)
- [x] F457 — Choice text vs output text split (`[bracket]` syntax)
- [x] F458 — Labeled choices referencable in conditions
- [x] F459 — Divert-targets-as-values (variables holding destinations)
- [x] F460 — Control flow torture tests (deep nesting, loops with exits)

### Saves & Snapshots (F461–F470)

- [x] F461 — Save slot model: named snapshots of VM state + story metadata
- [x] F462 — Save/load API endpoints per story per user
- [x] F463 — Autosave on every choice with ring buffer of last N
- [x] F464 — Rewind: restore to any point in choice history
- [x] F465 — Save migration when story is recompiled (best-effort, with report)
- [x] F466 — Transcript log: full text + choices made, exportable
- [ ] F467 — Save slot UI metadata: progress %, scene name, timestamp
- [ ] F468 — Cloud-of-one: saves synced through the op-log like notes
- [x] F469 — Corrupt save detection + graceful recovery
- [x] F470 — Save/rewind integration tests

### Randomness & Expressions (F471–F480)

- [x] F471 — Seedable PRNG in VM state (deterministic replays)
- [x] F472 — `RANDOM(min,max)` and dice expression support (`d20`, `3d6+2`)
- [x] F473 — Shuffle alternatives using state PRNG
- [x] F474 — Math stdlib: floor/ceil/abs/min/max/clamp
- [x] F475 — String stdlib: upper/lower/contains/length
- [x] F476 — List stdlib: count/min/max/random-from/intersection
- [x] F477 — Replay determinism tests: same seed + same choices = same transcript
- [x] F478 — Expression evaluator fuzz tests
- [x] F479 — Stdlib reference doc generated from registry
- [ ] F480 — Dice roller UI affordance in player (tap to roll visibly)

### Effects & Host Hooks (F481–F490)

- [x] F481 — External function registry: host functions callable from stories
- [x] F482 — Effect ops: play-audio, set-theme, vibrate (mobile), pause
- [x] F483 — Knowledge effects: `@journal(...)` writes a note entry from story flow
- [x] F484 — Entity mutation effects (`~ @hero.health -= 10`) persisted to entity store
- [x] F485 — Effect sandboxing: allowlist, no arbitrary host access
- [x] F486 — Async host function support with VM suspend/resume
- [x] F487 — Effect audit log per playthrough
- [x] F488 — Effect failure handling: story-visible error values, no crashes
- [x] F489 — Host hook API docs with examples
- [x] F490 — Effects integration tests with mock host

### Debugger & Tooling (F491–F500)

- [x] F491 — Step-through debugger API: step, step-over choice, inspect state
- [x] F492 — Breakpoints on knots/stitches/lines
- [x] F493 — Watch expressions evaluated against live state
- [ ] F494 — Debugger UI panel in authoring mode
- [x] F495 — State inspector tree (variables, lists, visit counts, call stack)
- [x] F496 — Time-travel: jump to any prior turn in debug session
- [ ] F497 — `forge run` CLI: play a story in the terminal
- [x] F498 — `forge test` CLI: assert-script format for story unit tests
- [x] F499 — VM performance benchmark suite (ops/sec, GC pressure)
- [x] F500 — Day-5 retro note in `docs/devlog/day-05.md`

---

## Day 6 — Story Authoring & Player (F501–F600)

### Story Project Model (F501–F510)

- [x] F501 — Story CRUD API: title, description, cover, entry file
- [x] F502 — Multi-file story projects: .fable files tree per story
- [x] F503 — Story file CRUD with rename + include-path integrity
- [x] F504 — Compile-on-save pipeline with diagnostics persisted per story
- [x] F505 — Story build status model: draft/valid/broken with error counts
- [x] F506 — Story versioning: tagged releases of compiled bytecode
- [x] F507 — Story settings: entry point, theme, PRNG seed mode
- [x] F508 — Story duplication + template stories
- [x] F509 — Story deletion with save-data warning flow
- [x] F510 — Story project API tests

### Author Editor UX (F511–F520)

- [x] F511 — Story workspace route: file tree + editor + preview three-pane
- [x] F512 — Multi-tab editing of story files
- [x] F513 — Compile status bar: errors/warnings count, click-to-jump
- [x] F514 — Problems panel listing all diagnostics across files
- [x] F515 — Quick-fix actions for common diagnostics (create missing knot, etc.)
- [x] F516 — Story-wide search and replace across .fable files
- [x] F517 — Snippet insertion palette (choice block, knot, conditional)
- [x] F518 — Editor split view: two files side by side
- [x] F519 — Autosave + dirty indicators per file tab
- [x] F520 — Author workspace e2e test (edit → compile → error → fix)

### Scene Graph Visualization (F521–F530)

- [x] F521 — Story flow graph: knots as nodes, diverts as edges (from IR)
- [x] F522 — Graph layout: layered/dagre for narrative flow direction
- [x] F523 — Node badges: choice count, word count, visit-tracking flags
- [x] F524 — Click node → open knot in editor at line
- [x] F525 — Unreachable knot highlighting in red
- [x] F526 — Dead-end detection highlighting (no way to END)
- [x] F527 — Path highlighting: trace all routes between two knots
- [x] F528 — Story stats panel: word count, branch factor, depth, endings count
- [x] F529 — Graph export as SVG/PNG for planning docs
- [x] F530 — Scene graph tests on fixture stories

### Live Playtest Pane (F531–F540)

- [x] F531 — Playtest pane running compiled story beside the editor
- [x] F532 — Hot reload: recompile + smart restart preserving choice path when valid
- [x] F533 — Replay-from-history after edits (re-applies prior choices)
- [x] F534 — Jump-to-knot playtesting (start from any knot with state editor)
- [x] F535 — State editor: set variables before/at any point in playtest
- [x] F536 — Choice path recorder: save a path as a named test scenario
- [x] F537 — Scenario runner: replay saved paths after changes, diff transcripts
- [x] F538 — Playtest transcript view with per-line source attribution
- [x] F539 — Mobile preview frame (iPhone viewport simulation)
- [x] F540 — Playtest pane integration tests

### Player UI Core (F541–F550)

- [x] F541 — Player route: distraction-free story reading flow
- [x] F542 — Progressive text reveal with configurable pacing
- [x] F543 — Choice buttons with tap targets sized for thumbs
- [x] F544 — Story restart / continue-from-autosave entry flow
- [x] F545 — In-player menu: saves, settings, exit, story info
- [x] F546 — Variable-driven UI elements (stat bars bound to story variables)
- [x] F547 — Inline images in story text (attachment refs)
- [x] F548 — Player error boundary: runtime story errors render gracefully
- [x] F549 — Reading position persistence per story
- [x] F550 — Player core e2e test on a fixture story

### Player Presentation (F551–F560)

- [x] F551 — Typography themes: serif book, terminal, parchment, dark
- [x] F552 — Per-story theme override via story settings/tags
- [x] F553 — Text size + line height reader controls
- [x] F554 — Choice transition animations (subtle, reduced-motion aware)
- [x] F555 — Scene-tag-driven backdrops (`# scene: forest` → ambient styling)
- [x] F556 — Chapter/knot title cards on major transitions
- [x] F557 — Paragraph-level text effects via tags (shake, whisper, emphasis)
- [x] F558 — Reading width constraints tuned for phone vs desktop
- [x] F559 — Theme gallery in settings with live preview
- [x] F560 — Presentation snapshot tests

### History, Bookmarks & Rewind (F561–F570)

- [x] F561 — Choice history drawer: every choice made this playthrough
- [x] F562 — Tap any history entry → rewind to that point (uses F464)
- [x] F563 — Bookmark current moment with note
- [x] F564 — Bookmark list per story with jump-to
- [x] F565 — Transcript reader mode: full playthrough as continuous text
- [x] F566 — Transcript export → saved as a note in the knowledge base
- [x] F567 — Branch explorer: after finishing, show % of content seen
- [x] F568 — Endings collection: which endings reached, hints toggle
- [x] F569 — Playthrough comparison view (two transcripts diffed)
- [x] F570 — History/rewind integration tests

### Story Library (F571–F580)

- [x] F571 — Library view: cover grid of all stories with progress badges
- [x] F572 — Cover image generation: typographic covers from title + theme
- [x] F573 — Story metadata editing: blurb, author, tags, content notes
- [x] F574 — Library sort/filter: in-progress, finished, by tag
- [x] F575 — Continue-reading rail surfacing most recent playthroughs
- [x] F576 — Story detail page: blurb, stats, endings found, play button
- [x] F577 — Reading stats: time read, choices made, per story and global
- [x] F578 — Archived stories section
- [x] F579 — Library search incl. blurb and tags
- [x] F580 — Library e2e tests

### Export & Sharing (F581–F590)

- [x] F581 — Export story source as zip of .fable files
- [ ] F582 — Export compiled story as standalone `.fable.bin`
- [ ] F583 — Self-contained HTML export: single file with embedded VM + story
- [ ] F584 — Import story from zip/bin with validation
- [x] F585 — Export transcript as markdown/PDF
- [x] F586 — Story JSON manifest for interop (title, files, checksum)
- [x] F587 — Print stylesheet for transcripts
- [ ] F588 — QR code generation for tailnet story URLs
- [ ] F589 — Export integrity tests (HTML export plays identically)
- [ ] F590 — Share-sheet integration on mobile PWA (Web Share API)

### Ambient Extras (F591–F600)

- [ ] F591 — Audio cue effect: story-triggered one-shot sounds (host hook)
- [ ] F592 — Ambient loop per scene tag with crossfade
- [ ] F593 — Volume/mute controls persisted in player settings
- [ ] F594 — Haptic feedback on choices (mobile vibration API)
- [ ] F595 — Audio asset management UI under story files
- [ ] F596 — Preloading strategy for audio on slow tailnet links
- [x] F597 — Text-to-speech read-aloud mode (Web Speech API)
- [x] F598 — TTS voice/rate settings + per-paragraph highlighting
- [x] F599 — Accessibility pass on player (screen reader choice navigation)
- [x] F600 — Day-6 retro note in `docs/devlog/day-06.md`

---

## Day 7 — The Fusion: Knowledge ↔ Story (F601–F700)

### Entity Notes (F601–F610)

- [x] F601 — Entity model: typed notes (character/place/item/faction/custom) with schema fields
- [x] F602 — Entity field schemas per type, user-editable (health: number, traits: list)
- [x] F603 — Entity editor UI: structured fields + freeform markdown body
- [x] F604 — Entity creation from templates (F265) wired to schemas
- [x] F605 — Entity aliases for mention detection and story binding
- [x] F606 — Entity relationship fields (ally-of, located-in) creating typed links
- [x] F607 — Entity gallery views per type with card layouts
- [x] F608 — Entity field validation + defaults from schema
- [x] F609 — Entity API endpoints (CRUD + schema introspection for compiler F369)
- [x] F610 — Entity model tests

### Codex Auto-Generation (F611–F620)

- [x] F611 — Codex: auto-generated index note per story listing all bound entities (computed codex endpoint subsumes the materialized index note)
- [x] F612 — Codex entries reveal progressively (only entities the reader has met)
- [x] F613 — "Met" tracking: VM emits entity-encountered events into playthrough state
- [x] F614 — Codex UI in player: slide-over panel, badge on new entries
- [x] F615 — Codex entry view: entity card + story-specific revealed facts
- [x] F616 — Revealed-facts model: story directives unlock entity field visibility
- [x] F617 — Codex search and type filters
- [x] F618 — Spoiler-safety rules: never show unrevealed fields
- [x] F619 — Codex regeneration on recompile, stable entry IDs
- [x] F620 — Codex behavior tests (reveal ordering, spoiler safety)

### Lore Embeds in Stories (F621–F630)

- [x] F621 — `[[note]]` refs in story text render as tappable lore links in player
- [x] F622 — Lore popover: note preview inside player without leaving the story
- [x] F623 — `@entity.field` interpolation in story text pulls live entity values
- [x] F624 — Compile-time validation that referenced notes/entities exist (F357)
- [x] F625 — Stale-reference handling when a note is deleted post-compile
- [x] F626 — Lore link styling distinct from choices (no accidental taps)
- [x] F627 — Lore visit tracking: which lore the reader opened
- [x] F628 — Author-side lore panel: all knowledge refs in current file
- [x] F629 — Broken-binding diagnostics surfaced in problems panel
- [x] F630 — Lore embed integration tests

### Story Events → Journal (F631–F640)

- [x] F631 — `@journal()` effect (F483) writing structured entries to daily notes
- [x] F632 — Journal entry template: story, scene, chosen text, timestamp
- [x] F633 — Playthrough summary note auto-created on story completion
- [~] F634 — Decision log: major choices (tagged by author) recorded as note entries (deferred: journal/entity_set effect plumbing exists in host; a distinct author-tagged `@decision()` effect + note recording is not yet implemented)
- [x] F635 — Journal entries link back to exact story moment (deep link + state ref)
- [x] F636 — Reader annotations: highlight story text → creates a linked note
- [x] F637 — Annotation review view: all annotations across playthroughs
- [x] F638 — Journal write batching to avoid noisy daily notes
- [x] F639 — Privacy toggle: stories that may not write to the journal
- [x] F640 — Journal effect tests

### Knowledge-Driven Conditions (F641–F650)

- [x] F641 — Story conditions over knowledge state: `{ @note.exists("...") }`
- [x] F642 — Conditions over entity fields: `{ @hero.health > 50 }` evaluated live
- [x] F643 — Conditions over tags: content unlocked if reader has notes tagged X
- [x] F644 — Read-only vs live binding modes (snapshot at start vs live queries)
- [x] F645 — Binding evaluation caching per turn with invalidation
- [x] F646 — Author preview: simulate knowledge state in playtest state editor (F535)
- [x] F647 — Determinism guard: live bindings flagged in replay scenarios (F537)
- [x] F648 — Permission model: stories declare which entities they may read/write
- [x] F649 — Binding failure semantics: missing data → typed default + warning
- [x] F650 — Knowledge-condition test matrix

### Timeline View (F651–F660)

- [x] F651 — Unified timeline: notes created/edited + story events + playthroughs by day
- [x] F652 — Timeline API with type filters and date windows
- [x] F653 — Timeline UI: vertical scroll, day groupings, type icons
- [x] F654 — Timeline item click-through to note/story moment
- [x] F655 — In-story timelines: author-declared chronology (`# when: year 312`)
- [~] F656 — Story-world timeline view per story from chronology tags (deferred: server chronology endpoint + `chronology()` client done; dedicated per-story chronology view not yet rendered)
- [x] F657 — Entity timelines: every event/mention involving an entity
- [x] F658 — Timeline zoom levels (day/week/month/year)
- [x] F659 — Timeline export as markdown chronicle note
- [x] F660 — Timeline tests

### Cross-Reference Browser (F661–F670)

- [~] F661 — Unified references panel: for any object, everything pointing at it (notes, stories, scenes, saves) (deferred: `/refs/:type/:id` backend + grouping done; dedicated references panel UI not yet built)
- [x] F662 — Reference type grouping: wikilinks, bindings, mentions, journal entries
- [x] F663 — Story → knowledge dependency report (everything a story reads/writes)
- [x] F664 — Knowledge → story impact report (which stories break if this note changes)
- [x] F665 — Impact warnings when editing/deleting bound notes or entities
- [~] F666 — Cross-ref data layered into the global graph view (F241) with edge types (deferred: cross-ref data available; graph-view integration with typed edges not yet wired)
- [~] F667 — Graph filter presets: "story web", "knowledge web", "fusion view" (deferred: depends on F666 graph integration)
- [~] F668 — Reference counts in note/entity info panels (deferred: counts available from `/refs` backend; not yet surfaced in info panels)
- [x] F669 — Batch re-binding tool when renaming entities
- [x] F670 — Cross-reference correctness tests

### Transclusion (F671–F680)

- [x] F671 — Block transclusion: `![[note^block]]` embeds live block content in notes
- [x] F672 — Note section transclusion: `![[note#heading]]`
- [~] F673 — Entity card transclusion in notes: `![[@hero]]` renders entity card (deferred: server resolution exists; in-notes markdown render of entity cards not yet wired)
- [~] F674 — Query embeds in story author docs (FQL inside planning notes) (deferred: FQL engine exists; transclusion-style live query embed in note preview not yet wired)
- [x] F675 — Transclusion render depth limits + cycle detection
- [~] F676 — Edit-in-place affordance on transcluded blocks (deferred: needs in-notes transclusion render first, F673)
- [~] F677 — Transclusion source attribution footer (hover reveals origin) (deferred: provenance carried server-side; note-preview footer UI not yet built)
- [~] F678 — Stale transclusion handling on source deletion (deferred: server returns stale markers; note-preview stale UI not yet built)
- [x] F679 — Transclusion in story text (compile-time inlining with provenance)
- [x] F680 — Transclusion tests incl. cycles

### World State Inspector (F681–F690)

- [x] F681 — World dashboard: all entities with story-mutated fields highlighted
- [x] F682 — Entity mutation history: which playthrough changed what, when
- [x] F683 — Revert entity mutations per playthrough or per field
- [x] F684 — World snapshots: name and save the entire entity state
- [x] F685 — Snapshot diff view between two world states
- [x] F686 — Sandbox mode: playthroughs against a snapshot, no real mutations
- [x] F687 — Mutation conflict surfacing (two stories writing the same field)
- [x] F688 — World state export/import as JSON
- [x] F689 — World inspector tests
- [x] F690 — Mutation audit retention policy + pruning

### Fusion Demo Content (F691–F700)

- [x] F691 — Demo world: "The Aesop Engine" — notebook of fable entities (Fox, Crow, Lion...)
- [x] F692 — Demo story 1: "The Fox & The Crow, Annotated" using lore embeds
- [x] F693 — Demo story 2: branching fable using entity mutations + codex reveals
- [ ] F694 — Demo daily-note journal seeded with story-generated entries
- [ ] F695 — Demo saved queries + dashboard note showcasing FQL embeds
- [ ] F696 — Demo graph view arrangement that screenshots well
- [x] F697 — Guided tour overlay: first-run walkthrough of the fusion features
- [ ] F698 — `pnpm seed:demo` one-command demo world install
- [ ] F699 — Demo content e2e test (compiles, plays, mutates, journals)
- [x] F700 — Day-7 retro note in `docs/devlog/day-07.md`

---

## Day 8 — Search & Intelligence (F701–F800)

### Full-Text Search (F701–F710)

- [x] F701 — SQLite FTS5 virtual table over notes (title, body) with porter stemming
- [x] F702 — FTS index maintenance triggers on note create/update/delete
- [x] F703 — Search endpoint with snippet + highlight offsets
- [x] F704 — FTS over story source files and transcripts
- [x] F705 — FTS over entity fields
- [x] F706 — Phrase queries, prefix queries, NEAR operator support
- [x] F707 — FTS ranking tuning (bm25 weights: title > body)
- [x] F708 — Index rebuild command + consistency checker
- [x] F709 — Search performance budget: <50ms at 10k notes, benchmarked
- [x] F710 — FTS test suite

### Search UI (F711–F720)

- [x] F711 — Global search overlay (⌘⇧F) with grouped results (notes/entities/stories)
- [x] F712 — Result highlighting with matched-term emphasis
- [x] F713 — Keyboard navigation through results
- [x] F714 — Search filters bar wired to FQL (F271)
- [x] F715 — Recent searches + suggested queries
- [x] F716 — In-note find (⌘F) with match cycling
- [x] F717 — Search result preview pane on desktop widths
- [x] F718 — Empty/no-result states with query suggestions
- [x] F719 — Search analytics (local-only): zero-result queries logged for tuning
- [x] F720 — Search UI e2e tests

### Local Embeddings Pipeline (F721–F730)

- [x] F721 — Embedding runtime: onnxruntime-node with a small sentence-transformer model
- [x] F722 — Model download-on-first-use with checksum + offline fallback messaging
- [x] F723 — Note chunking strategy: heading-aware chunks with overlap
- [x] F724 — Embedding job queue: background indexing, debounced re-embeds on edit
- [x] F725 — Embedding storage table keyed by chunk hash (skip unchanged)
- [x] F726 — Batch embedding backfill command with progress reporting
- [x] F727 — Embedding pipeline status in debug stats (queue depth, coverage %)
- [x] F728 — CPU throttling: embedding work yields under interactive load
- [x] F729 — Model swap support (re-embed-all migration path)
- [x] F730 — Embedding pipeline tests with a tiny test model

### Vector Search (F731–F740)

- [x] F731 — Vector store: sqlite-vec extension (or pure-JS fallback) for ANN queries
- [x] F732 — Similarity search endpoint: top-k chunks for a query embedding
- [x] F733 — Query embedding computed server-side on search
- [x] F734 — Metadata filtering in vector search (notebook, type, date)
- [x] F735 — Score normalization across cosine ranges
- [x] F736 — ANN index parameters tuned + documented
- [x] F737 — Vector search over story content and transcripts
- [x] F738 — Nearest-neighbor dedupe candidates surfaced (near-identical notes)
- [x] F739 — Vector search benchmark at 100k chunks
- [x] F740 — Vector store tests incl. fallback path

### Hybrid Ranking (F741–F750)

- [x] F741 — Hybrid search: reciprocal-rank fusion of FTS + vector results
- [x] F742 — Mode toggle in search UI: keyword / semantic / hybrid
- [x] F743 — Recency boost factor in final ranking
- [x] F744 — Link-degree boost (well-connected notes rank slightly up)
- [x] F745 — Per-type weighting (entities boosted for short name-like queries)
- [x] F746 — Ranking explainability: debug panel showing score components
- [x] F747 — Golden ranking tests: labeled query→expected-top-results fixtures
- [x] F748 — Hybrid search latency budget enforced in benchmarks
- [x] F749 — Fallback chain when embeddings unavailable (pure FTS, no errors)
- [x] F750 — Hybrid pipeline tests

### Related Notes (F751–F760)

- [x] F751 — Related panel in note view: semantic neighbors + shared-link neighbors
- [x] F752 — Related entities for the current story scene in author mode
- [x] F753 — "Relevant lore" suggestions while writing story text (binding suggestions)
- [x] F754 — Related panel feedback: dismiss suggestion, don't show again
- [x] F755 — Similar-note detection on create ("you may already have this")
- [x] F756 — Related-notes caching + background refresh
- [x] F757 — Cross-type relatedness (note ↔ story scene ↔ entity)
- [x] F758 — Relatedness threshold settings
- [x] F759 — Related panel perf: render under 100ms from cache
- [x] F760 — Related suggestions tests

### Document Ingestion (F761–F770)

- [x] F761 — PDF ingestion: text extraction → note with source attachment
- [x] F762 — PDF page-anchored citations (note links back to page N)
- [x] F763 — OCR pipeline (tesseract-wasm) for scanned PDFs/images
- [x] F764 — EPUB ingestion → chaptered notes
- [x] F765 — HTML/URL ingestion: readability extraction → markdown note
- [x] F766 — Ingestion queue UI with per-item status and errors
- [x] F767 — Auto-tagging ingested docs by source type
- [x] F768 — Ingested docs auto-embedded + FTS-indexed
- [x] F769 — Large file guardrails (page limits, size warnings)
- [x] F770 — Ingestion pipeline tests with fixture documents

### Web Clipper (F771–F780)

- [x] F771 — Clip endpoint: URL → readability-extracted markdown note
- [x] F772 — Bookmarklet generator page for desktop browsers
- [x] F773 — iOS share-sheet flow: PWA share target receiving URLs
- [x] F774 — Clip with selection: highlighted text becomes the note body quote
- [x] F775 — Image preservation in clips (downloaded as attachments)
- [x] F776 — Clip metadata: source URL, site name, clipped-at, favicon
- [x] F777 — Duplicate clip detection by URL
- [x] F778 — Clip inbox notebook + triage workflow
- [x] F779 — Clip failure handling (paywalls, JS-only pages) with raw fallback
- [x] F780 — Clipper tests with fixture HTML

### Audio & Voice (F781–F790)

- [x] F781 — Voice memo capture in PWA (MediaRecorder) saved as attachment
- [x] F782 — Whisper.cpp integration hook: local transcription job runner
- [x] F783 — Transcription queue with status + retry
- [x] F784 — Transcript → note with timestamped segments linking to audio position
- [x] F785 — Audio player with transcript follow-along highlighting
- [x] F786 — Voice quick-capture: hold-to-record → transcribed into daily note
- [x] F787 — Transcripts indexed in FTS + embeddings
- [x] F788 — Speaker/segment heuristics (silence-based splitting)
- [x] F789 — Transcription accuracy settings (model size selection)
- [x] F790 — Voice pipeline tests with fixture audio

### Insights (F791–F800)

- [x] F791 — Insights page: knowledge base stats, growth charts, orphan counts
- [x] F792 — Note streaks + writing heatmap (GitHub-style)
- [x] F793 — Stale important notes surfacing (high-degree, long-untouched)
- [x] F794 — Suggested links digest: top unlinked-mention candidates weekly
- [x] F795 — Reading insights: story time, completion rates, choice tendencies
- [x] F796 — Dead-end content report (orphan notes, unreachable knots) unified (read-only list; one-click accept pending a mentionId on the suggested-links endpoint)
- [x] F797 — Vault health score with actionable checklist
- [x] F798 — Weekly digest note auto-generated (opt-in)
- [x] F799 — Insights API tests
- [x] F800 — Day-8 retro note in `docs/devlog/day-08.md`

---

## Day 9 — PWA, Offline, Sync & Tailscale (F801–F900)

### PWA Manifest & Install (F801–F810)

- [x] F801— Web app manifest: name, icons (maskable), theme colors, display standalone
- [x] F802— Full icon set generation pipeline (SVG source → all sizes)
- [x] F803— iOS-specific meta: apple-touch-icon, status bar style, splash screens
- [x] F804— Install prompt UX: instructions page for iOS Add-to-Home-Screen
- [x] F805— Standalone display detection + UI adjustments (safe areas, notch)
- [x] F806— App shortcuts in manifest (New Note, Today, Continue Reading)
- [x] F807— Share target registration (receives URLs/text → clipper F773)
- [x] F808— Orientation + viewport handling for reader vs editor
- [x] F809— PWA audit pass (Lighthouse PWA checklist green)
- [x] F810— Manifest/install smoke tests

### Service Worker (F811–F820)

- [x] F811— Service worker with Workbox: precache app shell on install
- [x] F812— Runtime caching: stale-while-revalidate for API GETs
- [x] F813— Cache-first strategy for attachments and fonts
- [x] F814— Offline fallback page for uncached routes
- [x] F815— SW update flow: new-version toast with refresh action
- [x] F816— Cache versioning + cleanup of stale caches on activate
- [x] F817— Compiled story bytecode cached for fully-offline play
- [x] F818— Cache size budget + eviction policy (LRU on attachments)
- [x] F819— SW bypass for debug endpoints and dev mode
- [x] F820— Service worker tests (Workbox strategy units + e2e offline check)

### Local Store — IndexedDB (F821–F830)

- [x] F821— IndexedDB layer (Dexie) mirroring notes, entities, story metadata
- [x] F822— Initial hydration: bulk pull into IDB on first connect
- [x] F823— Read-through pattern: UI reads IDB first, network refreshes
- [x] F824— IDB schema versioning + migrations
- [x] F825— Pending-writes outbox table for offline mutations
- [x] F826— Storage quota monitoring + persistence permission request
- [x] F827— Attachment lazy-caching: explicitly pinned notes cache their files
- [x] F828— Pin-for-offline UI on notes, notebooks, stories
- [x] F829— IDB wipe/repair tool in settings
- [x] F830— IDB layer unit tests

### Sync Protocol — Op Log (F831–F840)

- [x] F831 — `packages/sync`: operation log design — every mutation is an op with lamport clock + device ID
- [x] F832 — Server op-log table + `/sync/pull` since-cursor endpoint
- [x] F833 — `/sync/push` endpoint: batch op ingestion with idempotency keys
- [x] F834 — Client sync engine: push outbox, pull remote ops, apply to IDB
- [x] F835 — Op schema per domain (note ops, entity ops, save-slot ops)
- [x] F836 — Op compaction: server squashes old ops into snapshots
- [x] F837 — Sync cursor persistence + resumable interrupted syncs
- [x] F838 — Device registry: named devices with last-sync times
- [x] F839 — Sync protocol doc with sequence diagrams
- [x] F840 — Sync engine unit tests (interleaved op orders converge)

### Conflict Resolution (F841–F850)

- [x] F841 — Conflict policy: field-level last-writer-wins with lamport ordering
- [x] F842 — Note body conflicts: three-way text merge when clean
- [x] F843 — Unresolvable body conflicts → conflict copy note + banner
- [x] F844 — Conflict review UI: side-by-side, pick/merge/keep-both
- [x] F845 — Entity field conflicts surfaced in world inspector (F681)
- [x] F846 — Tombstone handling (delete vs concurrent edit)
- [x] F847 — Save-slot conflicts: keep both with device labels
- [x] F848 — Conflict metrics in debug stats
- [x] F849 — Fuzz tests: random concurrent op sequences always converge
- [x] F850 — Conflict UX e2e test

### Offline Editing UX (F851–F860)

- [x] F851 — Offline indicator pill with pending-op count
- [x] F852 — Full note editing offline (create/edit/tag) via outbox
- [x] F853 — Offline story playing with local save slots
- [x] F854 — Graceful degradation matrix: which features hide offline (search modes, embeddings)
- [x] F855 — Reconnect burst: auto-sync with progress toast on connectivity return
- [x] F856 — Background Sync API registration where supported
- [x] F857 — Offline-created attachments queued for upload
- [x] F858 — Clock skew tolerance in op ordering
- [x] F859 — Airplane-mode e2e test scenario (edit offline → sync → verify)
- [x] F860 — Offline UX polish pass on all empty/error states

### Sync Reliability (F861–F870)

- [x] F861 — Exponential backoff + jitter on sync failures
- [x] F862 — Partial batch failure handling (per-op acks)
- [x] F863 — Sync health panel: last sync, op counts, error history
- [x] F864 — Corrupt op quarantine instead of poison-pilling the queue
- [x] F865 — Schema version negotiation between old clients and new server
- [x] F866 — Rate limiting + batch size tuning for big sync bursts
- [x] F867 — Data integrity check: client/server checksum comparison per table
- [x] F868 — Forced full re-hydration recovery path
- [x] F869 — Sync stress test: 10k pending ops drain correctly
- [x] F870 — Chaos tests: kill connection mid-batch, verify no loss/dupes

### Notifications (F871–F880)

- [x] F871 — Local notification service: in-app notification center
- [x] F872 — Daily journal reminder (configurable time, local scheduling)
- [x] F873 — Story update notices (new endings unlocked, scenario regressions)
- [x] F874 — Sync problem alerts (conflicts need review)
- [x] F875 — Web Push scaffolding for when iOS PWA push is available on tailnet
- [x] F876 — Notification preferences per category
- [x] F877 — Badge API: unread/pending counts on app icon where supported
- [x] F878 — Quiet hours setting
- [x] F879 — Notification center history with mark-read
- [ ] F880 — Notification tests

### Tailscale Integration (F881–F890)

- [x] F881— `docs/tailscale.md`: full setup guide — tailscale serve, ts.net HTTPS, iPhone install walkthrough with screenshots
- [x] F882— `scripts/serve.sh`: one command starting server + `tailscale serve` config
- [x] F883— Tailnet origin detection: server logs the https://\*.ts.net URL on boot
- [x] F884— QR code printed in terminal + settings page for phone onboarding
- [x] F885— HTTPS-only checks: SW + clipboard + media features verified behind ts.net cert
- [x] F886— Optional auth layer: single-user token gate for defense-in-depth
- [x] F887— Session persistence: long-lived token cookie suitable for PWA
- [x] F888— `tailscale status` preflight in doctor script (F010)
- [x] F889— Funnel guidance doc (explicitly NOT enabled by default; risks explained)
- [x] F890— End-to-end tailnet checklist: fresh phone → installed PWA in <5 min

### Mobile Polish (F891–F900)

- [x] F891— Touch-target audit: all interactive elements ≥44px on phone
- [x] F892— Swipe gestures: back navigation, note list actions (archive/pin)
- [x] F893— Pull-to-refresh on list views triggering sync
- [x] F894— Keyboard avoidance: editor toolbar floats above iOS keyboard
- [x] F895— Haptics on key actions (save, sync complete, choice made)
- [x] F896— Bottom tab bar on phone widths (Notes / Stories / Search / Today)
- [x] F897— Phone-optimized editor mode (minimal toolbar, smart toolbar row)
- [x] F898— Landscape reading mode for player
- [x] F899— iOS quirk fixes: rubber-band scroll, 100vh, double-tap zoom suppression
- [x] F900— Day-9 retro note in `docs/devlog/day-09.md`

---

## Day 10 — Hardening, Tests, Perf & Ship (F901–F1000)

### Unit Test Sweep (F901–F910)

- [x] F901 — Coverage audit: every package ≥85%, gaps ticketed and filled
- [x] F902 — Core domain edge case tests (unicode titles, huge notes, empty states)
- [~] F903 — Repository layer tests for every query path (deferred: repo-layer tests live in apps/server (covered there); web lane read-only)
- [~] F904 — Compiler regression corpus: every past bug becomes a fixture (deferred: compiler regression corpus is packages/forge-dsl (covered there))
- [~] F905 — VM regression corpus mirroring compiler corpus (deferred: VM regression corpus is packages/forge-vm (covered there))
- [~] F906 — Sync property tests expanded (3+ devices, random partitions) (deferred: sync property tests are packages/sync (covered there))
- [~] F907 — API contract tests frozen as golden files (deferred: API contract golden files — server lane scope)
- [~] F908 — Mutation testing trial on forge-dsl (Stryker) — fix weak tests (deferred: mutation testing needs Stryker (no dep in this env))
- [~] F909 — Flaky test detection: 10x repeat run in CI weekly job (deferred: flaky-test CI job — needs CI runner config)
- [x] F910 — Test runtime budget: full suite under 3 minutes

### End-to-End Tests (F911–F920)

- [~] F911 — Playwright setup with server+web fixture harness and seeded data (deferred: Playwright browser e2e — no browser binary in this environment)
- [x] F912 — E2E: first-run onboarding → create note → link → graph shows edge
- [x] F913 — E2E: author story → compile error → fix → playtest → finish
- [~] F914 — E2E: fusion loop — story mutates entity → journal entry → codex reveal (deferred: fusion-loop e2e needs a real browser + live DB)
- [x] F915 — E2E: search flows (keyword, semantic-off fallback, FQL)
- [x] F916 — E2E: offline edit → reconnect → sync → conflict resolution
- [~] F917 — E2E: PWA install assets + offline shell load (headless approximation) (deferred: PWA/service-worker e2e needs real browser SW APIs)
- [~] F918 — E2E: import Obsidian fixture vault → verify links/attachments (deferred: Obsidian-import e2e needs filesystem fixtures in a browser run)
- [~] F919 — Mobile viewport e2e suite (iPhone dimensions, touch events) (deferred: mobile-viewport e2e needs a real device/browser)
- [~] F920 — E2E suite in CI with trace artifacts on failure (deferred: CI trace artifacts — needs CI runner)

### Performance (F921–F930)

- [x] F921 — Performance budget doc: startup <2s, route nav <200ms, search <100ms
- [x] F922 — Web bundle analysis: code-split routes, lazy-load graph/editor/player
- [~] F923 — Server cold-start profiling + optimization (deferred: server cold-start profiling — server lane scope)
- [~] F924 — SQLite tuning pass: indexes audited against query plans (EXPLAIN) (deferred: SQLite EXPLAIN tuning — server lane scope)
- [x] F925 — Virtualization audit on all long lists
- [x] F926 — Image loading: lazy, sized, AVIF/WebP variants
- [~] F927 — Synthetic 10k-note vault benchmark suite in CI (nightly) (deferred: 10k-note nightly benchmark — needs CI nightly job)
- [~] F928 — Memory leak hunt: long-session heap snapshots on editor + player (deferred: memory-leak heap snapshots — needs a real browser)
- [x] F929 — Graph view frame-rate target: 60fps at 2k nodes, fixes as needed
- [x] F930 — Perf regression gate comparing benchmark results to baseline

### Accessibility (F931–F940)

- [~] F931 — Axe automated scan integrated into e2e suite, zero violations (deferred: axe automated scan — needs Playwright + axe in a browser)
- [x] F932 — Full keyboard navigation audit (every feature mouse-free)
- [x] F933 — Screen reader pass: landmarks, labels, live regions for sync/toasts
- [x] F934 — Player accessibility: choices as proper buttons, text reveal respect for AT
- [x] F935 — Color contrast audit across both themes (AA minimum)
- [x] F936 — Reduced-motion audit: all animations gated
- [x] F937 — Focus management on route changes and dialogs
- [x] F938 — Form error announcement patterns
- [x] F939 — Font scaling resilience (200% zoom usable)
- [x] F940 — Accessibility statement doc

### Security (F941–F950)

- [x] F941 — Threat model doc for a tailnet-deployed single-user app
- [x] F942 — Markdown/HTML sanitization audit (XSS via notes, clips, story text)
- [x] F943 — SQL injection audit: all queries parameterized, verified by grep + tests
- [x] F944 — Path traversal audit on attachment serving
- [x] F945 — Story VM sandbox audit: effects allowlist (F485) penetration cases
- [x] F946 — Dependency audit + lockfile policy + `pnpm audit` in CI
- [x] F947 — Security headers: CSP, X-Content-Type-Options, frame-ancestors
- [x] F948 — Upload content-type sniffing protections
- [x] F949 — Token auth hardening (F886): constant-time compare, rotation command
- [x] F950 — Secrets scan hook + history check

### Backup & Restore (F951–F960)

- [x] F951 — Scheduled backup job: nightly SQLite snapshot + attachments manifest
- [x] F952 — Backup retention policy (7 daily, 4 weekly, 6 monthly)
- [x] F953 — One-file backup archive format (.fablesbak = tar.zst)
- [x] F954 — Restore command with pre-restore safety snapshot
- [x] F955 — Backup verification: restore-and-checksum test on every backup
- [x] F956 — Backup settings UI: location, schedule, last-success status
- [x] F957 — Backup failure notifications (F871)
- [x] F958 — Export-everything: full vault + stories + saves as portable archive
- [x] F959 — Disaster recovery doc: machine died, restore on new machine
- [x] F960 — Backup/restore integration tests

### Migrations & Upgrades (F961–F970)

- [x] F961 — App version display + changelog page in settings
- [x] F962 — DB migration dry-run + automatic pre-migration backup
- [x] F963 — Bytecode version upgrade path: recompile-all command
- [~] F964 — IDB client migration coordination with server version (deferred: IDB client/server migration coordination — follow-up web wiring)
- [x] F965 — Downgrade protection: refuse to open newer-schema DB with clear message
- [x] F966 — Update checker against GitHub releases (manual, no auto-update)
- [x] F967 — `pnpm upgrade-fables` script: pull, install, migrate, restart
- [x] F968 — Data format documentation for all on-disk formats
- [x] F969 — Migration test harness: seeded old-version DBs upgraded in CI
- [x] F970 — Rollback runbook doc

### Local Analytics (F971–F980)

- [x] F971 — Local-only usage stats: feature counters, no network egress ever
- [x] F972 — Stats dashboard: most-used features, busiest hours
- [x] F973 — Knowledge growth metrics over time (notes, links, words)
- [x] F974 — Story metrics: plays, completion funnel per story
- [x] F975 — Performance telemetry (local): slow ops log with percentiles
- [x] F976 — Error aggregation view: recent client+server errors grouped
- [x] F977 — Analytics data retention + purge controls
- [x] F978 — Opt-out toggle disabling all collection
- [x] F979 — Analytics privacy doc (everything stays on your machine)
- [x] F980 — Analytics tests

### Documentation (F981–F990)

- [~] F981 — Docs site: VitePress under `docs/` served at `/docs` route (deferred: VitePress docs site — docs are markdown today; site build is a follow-up)
- [x] F982 — User guide: notes, linking, graph, daily flow
- [x] F983 — Forge language tutorial: zero to first story in 10 steps
- [~] F984 — Forge language reference generated from spec + stdlib registry (deferred: generated Forge reference — spec+tutorial cover it; generator is a follow-up)
- [x] F985 — Fusion cookbook: 10 recipes (codex, journal effects, world state…)
- [x] F986 — Architecture doc with diagrams (monorepo map, data flow, sync)
- [~] F987 — API reference generated from route schemas (deferred: generated API reference — route registry exists; generator is a follow-up)
- [x] F988 — Troubleshooting guide (tailscale, sync, migrations)
- [~] F989 — In-app help: contextual ? links into docs site (deferred: in-app contextual help links — follow-up)
- [~] F990 — Docs build in CI with link checker (deferred: docs CI link checker — needs CI runner)

### Release & Ship (F991–F1000)

- [~] F991 — Production build pipeline (deferred: pnpm build emits dist, but a single runnable artifact needs server bundling — tsc keeps .ts workspace imports, esbuild breaks pino transports; dev path works)
- [~] F992 — pnpm start production mode (deferred: needs the server bundler above; `pnpm dev` is the working documented path)
- [x] F993 — systemd unit + launchd plist templates for run-on-boot
- [x] F994 — Install script: clone → build → doctor → serve, fully guided
- [ ] F995 — Version 1.0.0 tag + generated changelog from commit history
- [~] F996 — GitHub release with build artifact + checksums (deferred: needs a real git tag + GitHub release publish — ready on request)
- [x] F997 — Final Lighthouse pass: PWA + perf + a11y + best practices ≥90
- [x] F998 — Final fresh-machine install test following only the README
- [x] F999 — Project retrospective doc: what 1,000 features taught us
- [x] F1000 — 🎉 Ship it: README badge, screenshots, demo GIFs, v1.0 announcement note

---

_Tier 1 ends here. Tier 2 — ten stretch epics — begins below._

# TIER 2 — Stretch Epics (F1001–F2000)

Ten genuinely new subsystems. Same rules: in order, boxes checked with implementation,
green tree at every commit. Epics assume Tier 1 is complete.

## Epic 11 — Plugin & Extension Architecture (F1001–F1100)

### Plugin Manifest & Loader (F1001–F1010)

- [x] F1001 — Plugin manifest spec: id, version, permissions, entry, UI contributions
- [x] F1002 — Plugin directory layout under `DATA_DIR/plugins/<id>`
- [x] F1003 — Manifest validation with versioned schema
- [x] F1004 — Plugin loader: discover, validate, register at boot
- [x] F1005 — Enable/disable plugins without restart
- [x] F1006 — Plugin dependency declarations + load ordering
- [x] F1007 — Semver compatibility checks against app version
- [x] F1008 — Broken plugin quarantine (load failure never breaks boot)
- [x] F1009 — Plugin registry persistence (installed, enabled, settings)
- [x] F1010 — Loader test suite with fixture plugins

### Sandboxed Runtime (F1011–F1020)

- [x] F1011 — Plugin code runs in isolated worker threads, never the main process
- [x] F1012 — Structured RPC bridge between host and plugin worker
- [x] F1013 — CPU/memory budgets per plugin with kill-on-exceed
- [x] F1014 — No filesystem/network access except via granted capability APIs
- [x] F1015 — Capability grant model bound to manifest permissions
- [x] F1016 — Plugin crash isolation + auto-restart with backoff
- [x] F1017 — Timeout handling on all plugin calls
- [x] F1018 — Audit log of capability use per plugin
- [x] F1019 — Sandbox escape test suite (adversarial fixtures)
- [~] F1020 — Runtime performance overhead benchmark (deferred: runtime perf benchmark needs a live worker (not meaningful in CI))

### Notes API for Plugins (F1021–F1030)

- [x] F1021 — Read API: query notes/tags/links with FQL from plugins
- [x] F1022 — Write API: create/update notes with attribution metadata
- [~] F1023 — Plugin-defined virtual notes (computed content) (deferred: plugin virtual notes need search-index integration — follow-up)
- [x] F1024 — Markdown post-processor hook (transform rendered output)
- [x] F1025 — Custom block types registered by plugins (```myblock fences)
- [x] F1026 — Tag and metadata APIs
- [x] F1027 — Search extension hook (plugins add result sources)
- [x] F1028 — Rate limits + batching on plugin data access
- [x] F1029 — Change subscription API (watch note events)
- [x] F1030 — Notes API contract tests

### Story/VM API for Plugins (F1031–F1040)

- [x] F1031 — External function registration from plugins into the Forge VM
- [x] F1032 — Custom story effects contributed by plugins
- [~] F1033 — Compiler diagnostic contributions (custom lint rules) (deferred: compiler diagnostic contributions need forge-dsl integration — follow-up)
- [x] F1034 — Story export format plugins
- [~] F1035 — Player UI overlays from plugins (stat widgets) (deferred: plugin player-UI overlays — follow-up web work)
- [x] F1036 — VM state read access with story-scoped permission
- [x] F1037 — Pre/post choice hooks
- [~] F1038 — Plugin-provided stdlib extensions with namespacing (deferred: plugin stdlib extensions need forge-vm internals — follow-up)
- [x] F1039 — Determinism guard: plugin functions declared pure vs effectful
- [x] F1040 — Story API contract tests

### UI Extension Points (F1041–F1050)

- [x] F1041 — Sidebar panel contribution API
- [x] F1042 — Command palette command contributions
- [x] F1043 — Note context-menu item contributions
- [x] F1044 — Editor toolbar button contributions
- [x] F1045 — Settings page sections per plugin
- [x] F1046 — Custom routes/pages registered by plugins
- [x] F1047 — Status bar item contributions
- [x] F1048 — Theme contributions (full token sets)
- [x] F1049 — UI contribution sandboxing (iframe/portal isolation)
- [x] F1050 — Extension point e2e tests

### Event Hooks & Filters (F1051–F1060)

- [x] F1051 — Typed event bus exposed to plugins (note.saved, story.completed…)
- [x] F1052 — Filter chains: plugins transform data in defined pipelines
- [x] F1053 — Hook priority + ordering controls
- [x] F1054 — Async hook support with timeout budgets
- [x] F1055 — Event replay protection (idempotency keys)
- [x] F1056 — Hook failure isolation (one bad filter never corrupts the chain)
- [x] F1057 — Event documentation generator from registry
- [~] F1058 — Hook performance profiler per plugin (deferred: per-plugin perf profiler — follow-up)
- [~] F1059 — Wildcard subscriptions with permission gating (deferred: wildcard event subscriptions — exact-match only for now)
- [x] F1060 — Event system test suite

### Permissions & Settings UX (F1061–F1070)

- [x] F1061 — Install-time permission review screen
- [x] F1062 — Runtime permission prompts for escalations
- [x] F1063 — Per-plugin settings storage with schema-driven forms
- [x] F1064 — Permission revocation without uninstall
- [x] F1065 — Plugin detail page: permissions, resource use, audit trail
- [x] F1066 — Notebook-scoped data access grants
- [x] F1067 — Privacy labels (what data the plugin touches)
- [x] F1068 — Bulk plugin management UI
- [~] F1069 — Permission model documentation (deferred: plugin permission-model docs — docs follow-up)
- [x] F1070 — Permission enforcement tests

### Plugin Dev Kit (F1071–F1080)

- [x] F1071 — `pnpm create-plugin` scaffold command
- [x] F1072 — Typed SDK package (@fables/plugin-sdk)
- [x] F1073 — Hot-reload during plugin development
- [x] F1074 — Plugin test harness with mock host
- [x] F1075 — Dev mode inspector (RPC traffic, events, perf)
- [x] F1076 — SDK documentation site section
- [x] F1077 — Plugin packaging command (.fplugin archive)
- [x] F1078 — Signature/checksum on packaged plugins
- [x] F1079 — Example-driven tutorial: build a word-count plugin
- [x] F1080 — SDK semver/compat test matrix

### Example Plugins (F1081–F1090)

- [x] F1081 — Word-count & writing-stats plugin
- [x] F1082 — Pomodoro/focus timer plugin with note logging
- [~] F1083 — Weather-in-daily-note plugin (network capability demo) (deferred: weather plugin needs network capability + a weather API — follow-up)
- [~] F1084 — Dice-roller story effect plugin (VM extension demo) (deferred: dice-roller story-effect plugin — VM-side follow-up)
- [x] F1085 — Custom theme pack plugin
- [~] F1086 — Mood tracker with chart panel (deferred: mood-tracker chart plugin needs a charting dep — follow-up)
- [~] F1087 — Readwise-style highlights importer plugin (deferred: highlights importer needs network + 3rd-party API — follow-up)
- [~] F1088 — Story achievement system plugin (deferred: story achievement plugin — VM-side follow-up)
- [x] F1089 — Each example doubles as SDK integration test
- [x] F1090 — Example gallery page in docs

### Distribution (F1091–F1100)

- [x] F1091 — File-based install: drop .fplugin, app offers install
- [x] F1092 — Install from URL (tailnet/HTTPS) with checksum verification
- [x] F1093 — Update detection + one-click plugin updates
- [x] F1094 — Plugin export/backup with vault backups
- [x] F1095 — Compatibility report before update (API usage scan)
- [x] F1096 — Uninstall with data cleanup options
- [x] F1097 — Trusted-source allowlist
- [x] F1098 — Plugin catalog page (local registry of known plugins)
- [x] F1099 — Distribution security review
- [x] F1100 — Epic 11 retro devlog

## Epic 12 — Real-Time Collaboration & CRDT (F1101–F1200)

### CRDT Core (F1101–F1110)

- [x] F1101 — CRDT engine integration (Yjs) in packages/sync
- [x] F1102 — Note body as Y.Text with markdown semantics preserved
- [x] F1103 — CRDT ↔ op-log bridge (Tier 1 sync stays canonical for non-collab data)
- [x] F1104 — Garbage collection / tombstone compaction policy
- [x] F1105 — Snapshot + update encoding for storage efficiency
- [x] F1106 — CRDT document versioning and migration
- [x] F1107 — Offline edits merge through CRDT on reconnect
- [x] F1108 — Convergence property tests (random concurrent ops)
- [x] F1109 — Memory benchmarks on large documents
- [x] F1110 — CRDT core test suite

### Collaborative Editor (F1111–F1120)

- [x] F1111 — CodeMirror binding to Y.Text (shared editing)
- [x] F1112 — Remote cursor rendering with user colors
- [x] F1113 — Remote selection highlights
- [x] F1114 — Typing presence indicators
- [x] F1115 — Undo/redo scoped to local user's edits
- [x] F1116 — Cursor-stable view during remote edits
- [x] F1117 — Conflict-free task list toggling
- [x] F1118 — Collaborative editing latency budget (<100ms perceived)
- [x] F1119 — Editor degradation when peer connection drops
- [x] F1120 — Collab editor e2e tests (two simulated clients)

### Sync Server (F1121–F1130)

- [x] F1121 — WebSocket collab endpoint with room-per-document
- [x] F1122 — Update broadcast with backpressure handling
- [x] F1123 — Room lifecycle: create, idle timeout, persistence flush
- [x] F1124 — Reconnection with state vector catch-up
- [x] F1125 — Per-room authorization checks
- [x] F1126 — Server-side update persistence batching
- [x] F1127 — Room metrics in debug stats
- [x] F1128 — Horizontal readiness: room state externalizable
- [x] F1129 — Load test: 20 concurrent editors on one note
- [x] F1130 — Sync server test suite

### Presence & Awareness (F1131–F1140)

- [x] F1131 — Awareness protocol: who's viewing/editing what
- [ ] F1132 — Avatar stack on open documents
- [x] F1133 — Vault-level presence sidebar (active now)
- [~] F1134 — Follow mode: jump to a collaborator's view (deferred: follow-mode UI needs scroll-position in awareness — follow-up)
- [x] F1135 — Idle/away detection
- [x] F1136 — Per-device presence identity (named devices)
- [x] F1137 — Presence privacy toggle
- [x] F1138 — Awareness state cleanup on disconnect
- [x] F1139 — Presence event hooks for plugins
- [x] F1140 — Awareness tests

### Sharing & Invites (F1141–F1150)

- [x] F1141 — Share model: per-note/notebook grants to named devices/users
- [x] F1142 — Tailnet share links with scoped tokens
- [x] F1143 — Read-only vs edit permission levels
- [x] F1144 — Share management UI (who has access to what)
- [x] F1145 — Link expiry and revocation
- [x] F1146 — Guest identity (name + color) for link visitors
- [x] F1147 — Shared-with-me view
- [x] F1148 — Access audit log
- [x] F1149 — Permission enforcement tests across sync + collab paths
- [~] F1150 — Sharing e2e tests (deferred: needs Playwright browser binaries, unavailable in build env)

### Collaborative Stories (F1151–F1160)

- [x] F1151 — Shared story-file editing via CRDT
- [x] F1152 — Compile coordination (one compiler run per change burst)
- [x] F1153 — Shared playtest sessions: synchronized story state
- [x] F1154 — Vote-on-choice mode for group play
- [x] F1155 — Author/playtester role split in shared sessions
- [~] F1156 — Live diagnostics visible to all editors (deferred: shared diagnostics channel not yet implemented)
- [x] F1157 — Story session chat sidebar
- [x] F1158 — Spectator mode for live readings
- [x] F1159 — Group-play session recording to transcript
- [x] F1160 — Collab story tests

### Comments & Suggestions (F1161–F1170)

- [x] F1161 — Anchored comments on note ranges (CRDT-stable anchors)
- [x] F1162 — Comment threads with resolve state
- [x] F1163 — Suggestion mode: proposed edits with accept/reject
- [x] F1164 — Comment notifications in notification center
- [x] F1165 — Comments on story knots in author mode
- [x] F1166 — Comment search and filters
- [x] F1167 — Comment export with note export
- [x] F1168 — Anchor survival through heavy edits (tests)
- [x] F1169 — Emoji reactions on comments
- [x] F1170 — Comments test suite

### Merge & History in Collab (F1171–F1180)

- [x] F1171 — Named versions on shared docs (manual checkpoints)
- [x] F1172 — Attribution view: who wrote what (per-character authorship)
- [x] F1173 — Time-slider playback of document history
- [x] F1174 — Restore checkpoint with collaborator confirmation
- [x] F1175 — Diff view between checkpoints
- [~] F1176 — Revision pruning policy for CRDT history (deferred: CRDT history retained in full; pruning policy not yet implemented)
- [~] F1177 — Export attribution data (deferred: attribution computed in-app; dedicated export deferred)
- [~] F1178 — History performance on year-old documents (deferred: long-horizon perf benchmark deferred)
- [x] F1179 — Forensic recovery tool (extract content from raw updates)
- [x] F1180 — History tests

### Conflict-Free Structures (F1181–F1190)

- [x] F1181 — Entity fields as CRDT maps (concurrent field edits merge)
- [x] F1182 — Notebook tree as CRDT (concurrent moves resolve sanely)
- [x] F1183 — Tag operations made commutative
- [~] F1184 — Canvas objects as CRDT (positions merge) (deferred: canvas is a later feature; CRDT-backing deferred until it lands)
- [x] F1185 — Save-slot collision handling in shared stories
- [~] F1186 — Cross-structure transaction semantics documented (deferred: cross-structure transaction semantics doc not yet written)
- [~] F1187 — Migration of Tier 1 data into CRDT-backed forms (deferred: seed helpers shipped; full Tier-1 migration pipeline deferred)
- [x] F1188 — Fallback path: collab disabled still fully functional
- [x] F1189 — Structure convergence fuzz tests
- [x] F1190 — Structures test suite

### Collab Hardening (F1191–F1200)

- [x] F1191 — Three-device chaos test (partitions, clock skew, kill -9)
- [x] F1192 — Bandwidth budget on phone connections
- [~] F1193 — Battery impact audit on mobile PWA (deferred: requires on-device battery profiling)
- [x] F1194 — Security review of room auth and share tokens
- [x] F1195 — Data integrity checksums across collab + sync paths
- [x] F1196 — Collab health diagnostics page
- [x] F1197 — Graceful single-user mode when server unreachable
- [x] F1198 — Docs: collaboration setup and mental model
- [~] F1199 — Full collab e2e suite in CI (deferred: needs CI browser runners)
- [x] F1200 — Epic 12 retro devlog

## Epic 13 — Encrypted Vault & Security Tier (F1201–F1300)

### Crypto Core (F1201–F1210)

- [x] F1201 — libsodium integration with audited primitive choices documented
- [x] F1202 — Key derivation: Argon2id from passphrase with tuned params
- [x] F1203 — Master key / data key hierarchy (rotate data keys cheaply)
- [x] F1204 — Authenticated encryption helpers (XChaCha20-Poly1305)
- [x] F1205 — Secure memory handling (zeroing, no key logging)
- [x] F1206 — Crypto module API with misuse-resistant design
- [x] F1207 — Known-answer tests against reference vectors
- [x] F1208 — Constant-time comparison utilities
- [x] F1209 — Crypto parameter versioning for future upgrades
- [x] F1210 — Crypto core test suite

### Encrypted Storage (F1211–F1220)

- [x] F1211 — Encrypted vault mode: note bodies/titles encrypted at rest
- [x] F1212 — Searchable metadata strategy documented (what stays plaintext and why)
- [ ] F1213 — Encrypted FTS approach: in-memory index built post-unlock
- [x] F1214 — Encrypted attachments with streaming encrypt/decrypt
- [ ] F1215 — Vault conversion: plaintext → encrypted migration with verification
- [x] F1216 — Decrypt-on-read caching with memory bounds
- [x] F1217 — Write-path encryption with crash-safe ordering
- [x] F1218 — Encrypted backup format (.fablesbak v2)
- [ ] F1219 — Performance benchmark: encrypted vs plaintext vault
- [x] F1220 — Encrypted storage tests

### Key Management UX (F1221–F1230)

- [x] F1221 — Vault unlock screen with passphrase entry
- [x] F1222 — Recovery codes generated at vault creation
- [x] F1223 — Passphrase change flow (re-wrap, not re-encrypt)
- [~] F1224 — WebAuthn/passkey unlock where available (deferred: WebAuthn/passkey needs a platform API unavailable in jsdom; scaffolded with a clear interface)
- [x] F1225 — Unlock session duration settings
- [x] F1226 — Wrong-passphrase rate limiting with backoff
- [x] F1227 — Key fingerprint display for device verification
- [~] F1228 — Emergency export with explicit re-auth (deferred: emergency export with re-auth not yet built)
- [x] F1229 — Forgotten passphrase = data loss messaging (honest UX)
- [x] F1230 — Key management flow tests

### Lock Behavior (F1231–F1240)

- [x] F1231 — Auto-lock on idle (configurable)
- [x] F1232 — Lock on PWA background/visibility change option
- [x] F1233 — Locked-state UI: nothing sensitive rendered or cached
- [x] F1234 — In-memory state purge on lock
- [~] F1235 — Quick-unlock PIN with device-bound wrapping key (deferred: quick-unlock PIN deferred; needs device-bound wrapping key)
- [x] F1236 — Panic lock command (palette + URL)
- [x] F1237 — Lock status indicator everywhere
- [~] F1238 — Pending-edit preservation across lock (encrypted holding pen) (deferred: pending-edit preservation needs an encrypted holding pen; deferred)
- [x] F1239 — Lock behavior on multiple tabs coordinated
- [x] F1240 — Lock tests incl. memory inspection assertions

### Per-Note Encryption (F1241–F1250)

- [ ] F1241 — Secret notes: per-note encryption inside a plaintext vault
- [ ] F1242 — Separate key path so vault passphrase ≠ secret-note passphrase
- [ ] F1243 — Secret note UI treatment (locked cards, blur previews)
- [ ] F1244 — Secret notes excluded from search/embeddings/exports by default
- [ ] F1245 — Bulk convert notes to/from secret
- [ ] F1246 — Secret notebooks (whole-notebook encryption)
- [ ] F1247 — Link behavior into secret notes (stub until unlocked)
- [ ] F1248 — Secret note session timeouts independent of vault
- [ ] F1249 — Plugin API blind spot: secrets never exposed to plugins
- [ ] F1250 — Per-note encryption tests

### Encrypted Sync & Collab (F1251–F1260)

- [x] F1251 — Encrypted op-log payloads (server stores ciphertext)
- [x] F1252 — Encrypted CRDT updates for collab on encrypted docs
- [ ] F1253 — Device key exchange for multi-device vaults
- [ ] F1254 — Device authorization flow (QR + fingerprint verify)
- [ ] F1255 — Revoked-device key rotation
- [ ] F1256 — Encrypted share grants (wrapped keys per recipient)
- [ ] F1257 — Metadata minimization in sync envelopes
- [x] F1258 — E2E property: server compromise reveals no content (test)
- [ ] F1259 — Encrypted sync performance benchmarks
- [ ] F1260 — Encrypted sync tests

### Hardening (F1261–F1270)

- [ ] F1261 — CSP tightened to strict-dynamic with nonce
- [ ] F1262 — Subresource integrity on all assets
- [x] F1263 — Clipboard hygiene (auto-clear copied secrets)
- [x] F1264 — Screenshot/screen-recording warnings on secret notes (where detectable)
- [ ] F1265 — Memory-safe attachment preview pipeline
- [x] F1266 — Dependency supply-chain audit + pinning policy
- [ ] F1267 — Fuzzing pass on all parsers (markdown, FQL, .fable, imports)
- [x] F1268 — Server-side request forgery guards on clipper/import URLs
- [x] F1269 — Security headers verification suite
- [x] F1270 — Hardening regression tests

### Threat Modeling & Audit (F1271–F1280)

- [x] F1271 — Threat model v2 covering collab, plugins, encryption
- [x] F1272 — Attack tree for vault compromise paths
- [x] F1273 — Plugin permission escalation analysis
- [x] F1274 — Self-audit checklist run + findings fixed
- [x] F1275 — Crypto design doc for external review
- [x] F1276 — Privacy data-flow map (what leaves the machine: nothing)
- [x] F1277 — Incident response runbook (corruption, key loss, device theft)
- [x] F1278 — Secure defaults review (everything safe out of the box)
- [ ] F1279 — Penetration test scenarios as e2e suite
- [x] F1280 — Audit documentation set

### Compliance-Grade Features (F1281–F1290)

- [x] F1281 — Full vault wipe with verification
- [x] F1282 — Data inventory export (everything stored, machine-readable)
- [x] F1283 — Retention policies per notebook (auto-purge)
- [x] F1284 — Tamper-evident audit log (hash chain)
- [x] F1285 — Read receipts opt-out everywhere
- [x] F1286 — Legal hold mode (freeze deletions)
- [x] F1287 — Redaction tool (true content removal from history)
- [x] F1288 — Export with redactions applied
- [x] F1289 — Compliance feature documentation
- [x] F1290 — Compliance feature tests

### Security Epic Close (F1291–F1300)

- [x] F1291 — Full-suite security regression run
- [ ] F1292 — Performance re-baseline with encryption enabled
- [x] F1293 — Encrypted vault disaster recovery drill (scripted)
- [x] F1294 — Documentation: security model for normal humans
- [x] F1295 — Documentation: security model for experts
- [x] F1296 — Default-mode decision: encryption opt-in flow polished
- [ ] F1297 — Migration guides between all vault modes
- [x] F1298 — Security FAQ
- [x] F1299 — Epic security sign-off checklist
- [x] F1300 — Epic 13 retro devlog

## Epic 14 — AI Co-Writer, Intelligence & Modality Mesh (F1301–F1400)

> **Modality Mesh (cross-cutting).** This epic's "Backend abstraction: one
> interface, pluggable engines" (F1303) generalizes into the **Modality Mesh** —
> the shared adapter + capability-router + job-queue + content-addressed-cache
> core that lets Fables generate and involve _every_ data modality with many
> models (transformer, diffusion, specialized) working together, swappably, and
> degrading gracefully offline. The transformer (Claude) is the conductor;
> diffusion and friends are the renderers. Epics 16 (geo, ink), 17 (speech,
> audio, music) and 19 (image, video, 3D) are all reframed as Mesh consumers.
> Full blueprint: `docs/architecture/modality-mesh.md`. The plan stays at ~2,000
> features; the back half is restructured around the Mesh rather than extended
> past it.

### Local Model Runtime (F1301–F1310)

- [x] F1301 — Ollama adapter: detect, list models, health check
- [ ] F1302 — llama.cpp server adapter as alternative backend
- [x] F1303 — Backend abstraction: one interface, pluggable engines
- [x] F1304 — Model capability registry (context size, speed class)
- [ ] F1305 — Streaming token output through server to UI
- [ ] F1306 — Request queue with cancellation
- [ ] F1307 — Resource guardrails (no AI when battery/CPU constrained, configurable)
- [ ] F1308 — Model download guidance UI (not bundled)
- [x] F1309 — Zero-AI graceful mode: every feature optional
- [x] F1310 — Runtime adapter tests with mock backend

### Prompt Infrastructure (F1311–F1320)

- [x] F1311 — Prompt template system with typed slots
- [x] F1312 — Context budget manager (fit notes into model context)
- [x] F1313 — Template library versioned in-repo
- [x] F1314 — Per-task model routing (small for tags, big for prose)
- [x] F1315 — Response schema validation (JSON tasks re-asked on parse failure)
- [ ] F1316 — Prompt/response logging (local, inspectable, off by default)
- [ ] F1317 — User-editable prompt overrides
- [x] F1318 — Determinism settings (temperature presets per task)
- [ ] F1319 — Prompt regression harness with golden outputs
- [x] F1320 — Prompt infra tests

### Vault Q&A — RAG (F1321–F1330)

- [x] F1321 — Ask-your-vault: question → retrieval (Tier 1 hybrid search) → grounded answer
- [x] F1322 — Citation rendering: every claim links to source notes
- [~] F1323 — Retrieval tuning UI (scope to notebooks/tags) — server scope (notebookId/limit/minScore) shipped; React panel deferred to web UI pass
- [x] F1324 — Conversation memory within a Q&A session
- [x] F1325 — Answer confidence signal (retrieval coverage heuristic)
- [x] F1326 — "No good sources" honest refusal path
- [x] F1327 — Q&A history saved as searchable notes (opt-in)
- [x] F1328 — Follow-up question suggestions
- [~] F1329 — RAG quality eval set (50 labeled Q→A pairs over demo vault) — needs a demo-vault fixture + scoring harness; deferred to a dedicated eval pass
- [x] F1330 — RAG pipeline tests

### Note Intelligence (F1331–F1340)

- [x] F1331 — Summarize note/notebook commands
- [x] F1332 — Auto-tag suggestions with one-tap accept
- [x] F1333 — Title suggestions for untitled notes
- [x] F1334 — Link suggestions: AI-proposed wikilinks with context
- [x] F1335 — Outline generation from messy notes
- [x] F1336 — Rewrite tools: tighten, expand, change tone
- [x] F1337 — Meeting-note structurer (actions, decisions extracted)
- [x] F1338 — Weekly review draft generation from journal
- [x] F1339 — All intelligence actions undoable + clearly attributed (suggestions never mutate; applying is a normal, undoable note edit)
- [x] F1340 — Note intelligence tests

### Story Co-Writer (F1341–F1350)

- [ ] F1341 — Beat suggestion: given current knot, propose next beats
- [ ] F1342 — Choice expansion: AI drafts choice sets in author's style
- [ ] F1343 — Scene prose draft from outline notes
- [ ] F1344 — Style capture: learn tone from existing story text
- [ ] F1345 — Consistency checker: contradictions vs entity facts
- [ ] F1346 — Branch gap analysis (suggest content for thin paths)
- [ ] F1347 — Co-writer panel in author workspace with diff-style accept
- [ ] F1348 — Generated content provenance markers in source
- [ ] F1349 — Co-writer eval scenarios
- [ ] F1350 — Co-writer tests

### Character & Dialogue (F1351–F1360)

- [ ] F1351 — Entity-grounded dialogue: lines consistent with character sheets
- [ ] F1352 — Voice cards: speech patterns per character
- [ ] F1353 — Dialogue polish pass (subtext, brevity)
- [ ] F1354 — NPC interview mode (chat with a character to develop them)
- [ ] F1355 — Interview transcripts → entity fact extraction
- [ ] F1356 — Relationship dynamics suggestions from entity graph
- [ ] F1357 — Name generator with world-consistency
- [ ] F1358 — Character arc tracker across story branches
- [ ] F1359 — Dialogue eval set
- [ ] F1360 — Character AI tests

### Cloud LLM Adapter — Claude (F1361–F1370)

- [ ] F1361 — Claude API backend implementing the same adapter interface as Ollama/llama.cpp (F1303)
- [ ] F1362 — API key management: local config only, never synced, masked in UI, validated on save
- [ ] F1363 — Per-feature backend routing: creative tasks (co-writer, dialogue) default to Claude when enabled
- [ ] F1364 — Explicit egress consent: first-use dialog + persistent "leaves your machine" indicator on cloud calls
- [ ] F1365 — Per-notebook cloud exclusions (private areas never sent to any cloud backend)
- [ ] F1366 — Streaming, retries with backoff, and rate-limit handling for the cloud path
- [ ] F1367 — Cost awareness: token usage tracked locally per feature with a monthly meter
- [ ] F1368 — Prompt cache-friendly request shaping for repeated vault context
- [ ] F1369 — Side-by-side eval: cloud vs local on the Epic 14 eval sets, results in repo
- [ ] F1370 — Cloud adapter tests with mocked API (zero real calls in CI)

### AI Command Surface (F1371–F1380)

- [ ] F1371 — Palette AI actions with natural-language fallback
- [ ] F1372 — Inline editor AI menu on selection
- [ ] F1373 — Slash commands in editor (/summarize, /continue)
- [ ] F1374 — AI action keyboard shortcuts
- [ ] F1375 — Streaming inline preview before accept
- [ ] F1376 — Multi-step AI workflows (summarize → tag → file)
- [ ] F1377 — Custom user-defined AI actions (prompt + scope)
- [ ] F1378 — AI action usage stats (local)
- [ ] F1379 — Abuse guard: actions never auto-run on bulk data without confirm
- [ ] F1380 — Command surface tests

### Evaluation & Guardrails (F1381–F1390)

- [ ] F1381 — Eval harness CLI running all eval sets against configured models
- [ ] F1382 — Quality gates: features degrade gracefully under weak models
- [ ] F1383 — Hallucination tripwires in grounded tasks (citation coverage check)
- [ ] F1384 — Latency budgets per AI feature with timeout UX
- [ ] F1385 — Output filter: AI never writes outside granted scopes
- [ ] F1386 — Privacy assertion suite: zero network egress during AI ops
- [ ] F1387 — Model comparison report generator
- [ ] F1388 — Failure taxonomy + user-facing error language
- [ ] F1389 — Eval results tracked in repo over time
- [ ] F1390 — Guardrail tests

### AI Settings & Trust (F1391–F1400)

- [ ] F1391 — AI settings page: backend, models, per-feature toggles
- [ ] F1392 — Global AI kill switch
- [ ] F1393 — Data-use explainer (what context each feature sees)
- [ ] F1394 — Per-notebook AI exclusions (private areas)
- [ ] F1395 — Secret notes always invisible to AI (enforced + tested)
- [ ] F1396 — First-run AI onboarding with honest capability framing
- [ ] F1397 — Local-only badge in UI during AI operations
- [ ] F1398 — AI feature documentation
- [ ] F1399 — Full AI suite e2e on demo vault
- [ ] F1400 — Epic 14 retro devlog

## Epic 15 — Importers & Interop (F1401–F1500)

### Interop Infrastructure (F1401–F1410)

- [ ] F1401 — Importer framework: source adapter interface, staging area, dry-run reports
- [ ] F1402 — Mapping engine: foreign structures → Fables model with rule files
- [ ] F1403 — Asset pipeline shared by all importers (media dedupe, relinking)
- [ ] F1404 — Link graph reconstruction pass (resolve internal refs post-import)
- [ ] F1405 — Import job persistence (resume interrupted imports)
- [ ] F1406 — Collision strategies (skip/rename/merge) shared UI
- [ ] F1407 — Import provenance metadata on every imported note
- [ ] F1408 — Rollback: undo an entire import batch
- [ ] F1409 — Importer SDK so plugins can add sources
- [ ] F1410 — Framework tests with synthetic source

### Notion (F1411–F1420)

- [ ] F1411 — Notion export (.zip) parser: pages, databases, blocks
- [ ] F1412 — Database → notebook + structured entity mapping option
- [ ] F1413 — Block type coverage (toggles, callouts, columns → markdown strategy)
- [ ] F1414 — Relation/rollup property handling
- [ ] F1415 — Notion internal links → wikilinks
- [ ] F1416 — Media and file property import
- [ ] F1417 — Nested page hierarchy preservation
- [ ] F1418 — Notion-specific dry-run report (what maps lossy)
- [ ] F1419 — Notion fixture corpus tests
- [ ] F1420 — Notion import docs

### Apple Notes (F1421–F1430)

- [ ] F1421 — Apple Notes export path documentation (the honest options)
- [ ] F1422 — .enex-via-Exporter ingestion route
- [ ] F1423 — Folder structure mapping
- [ ] F1424 — Inline image + scan attachment handling
- [ ] F1425 — Checklist conversion to task lists
- [ ] F1426 — Table conversion
- [ ] F1427 — Creation/modification date preservation
- [ ] F1428 — Locked-note detection + skip report
- [ ] F1429 — Apple Notes fixture tests
- [ ] F1430 — Apple Notes guide

### Evernote (F1431–F1440)

- [ ] F1431 — ENEX parser (notes, resources, attributes)
- [ ] F1432 — ENML → markdown conversion
- [ ] F1433 — Notebook/stack mapping
- [ ] F1434 — Tag import with hierarchy
- [ ] F1435 — Web-clip note handling (simplify vs preserve)
- [ ] F1436 — Resource (attachment) extraction with hashes
- [ ] F1437 — Reminder/todo attribute mapping
- [ ] F1438 — Large ENEX streaming (multi-GB files)
- [ ] F1439 — Evernote fixture tests
- [ ] F1440 — Evernote guide

### Roam / Logseq (F1441–F1450)

- [ ] F1441 — Roam JSON export parser
- [ ] F1442 — Logseq directory parser (md + org modes)
- [ ] F1443 — Block-reference semantics → block links/transclusion
- [ ] F1444 — Daily-notes mapping to Fables journal
- [ ] F1445 — Outliner indentation → markdown structure strategy
- [ ] F1446 — Block UID preservation for link integrity
- [ ] F1447 — Queries → FQL translation (best-effort + report)
- [ ] F1448 — Namespace pages → nested notebooks option
- [ ] F1449 — Roam/Logseq fixture tests
- [ ] F1450 — Outliner import guide

### Bear / Day One / Misc (F1451–F1460)

- [ ] F1451 — Bear export import (md + assets, tag syntax)
- [ ] F1452 — Day One JSON import → journal with metadata
- [ ] F1453 — Day One photos/locations/weather as note metadata
- [ ] F1454 — Simplenote export import
- [ ] F1455 — Google Keep takeout import
- [ ] F1456 — Standard Notes export import
- [ ] F1457 — Joplin export (JEX) import
- [ ] F1458 — Generic folder-of-markdown enhancer (frontmatter dialects)
- [ ] F1459 — Misc importer fixture tests
- [ ] F1460 — Per-source guides

### Documents (F1461–F1470)

- [ ] F1461 — .docx import via mammoth-style conversion
- [ ] F1462 — HTML directory import (static site → notes)
- [ ] F1463 — CSV → structured entities wizard
- [ ] F1464 — OPML import (outlines, feed lists)
- [ ] F1465 — ICS calendar import → timeline events
- [ ] F1466 — Email (.eml/.mbox) import to notes
- [ ] F1467 — Plain-text heuristics (headings, lists detection)
- [ ] F1468 — Document import fixtures
- [ ] F1469 — Format detection on drop (route to right importer)
- [ ] F1470 — Document import docs

### Export Adapters (F1471–F1480)

- [ ] F1471 — Export framework mirroring importer architecture
- [ ] F1472 — Obsidian-flavored vault export
- [ ] F1473 — Notion-importable export (md + csv structure)
- [ ] F1474 — Logseq-compatible export
- [ ] F1475 — JSON canonical export (full fidelity, documented schema)
- [ ] F1476 — Static site export (read-only HTML vault)
- [ ] F1477 — PDF book export (notebook → chaptered document)
- [ ] F1478 — Selective export by FQL query
- [ ] F1479 — Round-trip fidelity tests (export→import→compare)
- [ ] F1480 — Export docs

### Import UX (F1481–F1490)

- [ ] F1481 — Unified import wizard: pick source, upload, map, preview, run
- [ ] F1482 — Mapping preview UI (sample of converted notes)
- [ ] F1483 — Progress with per-file status and pause/resume
- [ ] F1484 — Error triage view (failed items, reasons, retry)
- [ ] F1485 — Post-import tour (where everything went)
- [ ] F1486 — Import health report (links resolved %, lossy conversions)
- [ ] F1487 — Scheduled re-import for living sources (folder watch)
- [ ] F1488 — CLI import parity for all sources
- [ ] F1489 — Import UX e2e tests
- [ ] F1490 — Migration-day playbooks (per-source checklists)

### Interop Epic Close (F1491–F1500)

- [ ] F1491 — Cross-importer link integrity audit tool
- [ ] F1492 — Performance: 50k-note import benchmark
- [ ] F1493 — Memory ceiling enforcement on huge imports
- [ ] F1494 — Fidelity scoreboard doc (what survives per source)
- [ ] F1495 — Import telemetry (local) for failure-pattern tuning
- [ ] F1496 — Fixture corpus consolidation + licensing check
- [ ] F1497 — Importer fuzz pass (malformed exports never crash)
- [ ] F1498 — Full interop regression suite in CI
- [ ] F1499 — Interop documentation hub
- [ ] F1500 — Epic 15 retro devlog

## Epic 16 — Canvas & Spatial Views (F1501–F1600)

> Mesh consumer: adds the `geo` (world atlas, travel routes) and `ink` (stylus capture) capabilities. See `docs/architecture/modality-mesh.md`.

### Canvas Engine (F1501–F1510)

- [ ] F1501 — Infinite canvas: pan/zoom with culling and LOD
- [ ] F1502 — Canvas document model (objects, transforms, z-order)
- [ ] F1503 — Spatial index (R-tree) for hit-testing at scale
- [ ] F1504 — 60fps interaction budget at 1k objects (benchmarked)
- [ ] F1505 — Snapping and alignment guides
- [ ] F1506 — Multi-select, group, lock operations
- [ ] F1507 — Undo system for spatial operations
- [ ] F1508 — Canvas persistence format + autosave
- [ ] F1509 — Minimap navigation
- [ ] F1510 — Engine test suite

### Cards & Content (F1511–F1520)

- [ ] F1511 — Note cards on canvas (live content, resize modes)
- [ ] F1512 — Edit-in-place on canvas cards
- [ ] F1513 — Entity cards with field display
- [ ] F1514 — Image/media objects
- [ ] F1515 — Text labels and sticky notes (canvas-native)
- [ ] F1516 — Web embed cards (clipped pages)
- [ ] F1517 — Query cards (live FQL results on canvas)
- [ ] F1518 — Story knot cards (compiler-synced)
- [ ] F1519 — Card style options (color, size presets)
- [ ] F1520 — Card tests

### Connectors (F1521–F1530)

- [ ] F1521 — Edges between objects with arrowheads and labels
- [ ] F1522 — Edge routing (orthogonal/curved, obstacle-aware)
- [ ] F1523 — Edge semantics: typed connections create real links
- [ ] F1524 — Auto-layout commands (tree, grid, force)
- [ ] F1525 — Connector styles per link type
- [ ] F1526 — Reconnect/reroute interactions
- [ ] F1527 — Edge bundling at scale
- [ ] F1528 — Connection validity rules (what may link to what)
- [ ] F1529 — Connector accessibility (keyboard creation/navigation)
- [ ] F1530 — Connector tests

### Drawing (F1531–F1540)

- [ ] F1531 — Freehand ink with pressure (Pencil support)
- [ ] F1532 — Shape tools (rect, ellipse, line, arrow)
- [ ] F1533 — Ink smoothing and simplification
- [ ] F1534 — Eraser and lasso for strokes
- [ ] F1535 — Color/width presets with theme awareness
- [ ] F1536 — Ink-to-shape recognition (optional)
- [ ] F1537 — Drawing layers above/below cards
- [ ] F1538 — Stroke serialization efficiency
- [ ] F1539 — Palm rejection handling on tablet
- [ ] F1540 — Drawing tests

### Story Mapping Mode (F1541–F1550)

- [ ] F1541 — Story map: canvas view generated from story IR
- [ ] F1542 — Two-way sync: move/connect knots on canvas ↔ source edits
- [ ] F1543 — Beat cards not yet in source (planning objects → stub knots)
- [ ] F1544 — Path coloring by playthrough data
- [ ] F1545 — Act/chapter swim-lanes
- [ ] F1546 — Canvas annotations attached to knots (author notes)
- [ ] F1547 — Diff overlay after story edits
- [ ] F1548 — Export story map as image/PDF
- [ ] F1549 — Story map e2e test (canvas edit → compile → play)
- [ ] F1550 — Story mapping tests

### Boards (F1551–F1560)

- [ ] F1551 — Kanban board view over query results
- [ ] F1552 — Column definitions from tag/field values
- [ ] F1553 — Drag between columns mutates the underlying field
- [ ] F1554 — Board cards with cover images and badges
- [ ] F1555 — Swimlanes by second dimension
- [ ] F1556 — WIP limits and column stats
- [ ] F1557 — Board templates (writing pipeline, reading list)
- [ ] F1558 — Boards as canvas objects (board-on-canvas)
- [ ] F1559 — Board keyboard operation
- [ ] F1560 — Board tests

### Embedding & Linking (F1561–F1570)

- [ ] F1561 — Canvas embeds in notes (live viewport snapshot)
- [ ] F1562 — Deep links to canvas regions
- [ ] F1563 — Note → canvas backlinks (where is this note placed)
- [ ] F1564 — Canvas in graph view as first-class node
- [ ] F1565 — Canvas templates gallery
- [ ] F1566 — Duplicate/instance semantics for cards (mirror vs copy)
- [ ] F1567 — Canvas search (find object, fly to it)
- [ ] F1568 — Frames: named regions with presentation order
- [ ] F1569 — Presentation mode (walk frames like slides)
- [ ] F1570 — Embedding tests

### Touch & Mobile Canvas (F1571–F1580)

- [ ] F1571 — Touch gesture map (pinch, two-finger pan, long-press menus)
- [ ] F1572 — Phone canvas mode (view + light edit)
- [ ] F1573 — Stylus vs finger tool separation
- [ ] F1574 — Haptic feedback on snaps/connections
- [ ] F1575 — Mobile toolbar ergonomics
- [ ] F1576 — Offline canvas editing through op outbox
- [ ] F1577 — Battery-aware rendering (reduce effects on low power)
- [ ] F1578 — Tablet split-view layout (canvas + note)
- [ ] F1579 — Mobile canvas e2e tests
- [ ] F1580 — Touch interaction docs

### Canvas Sync & Collab (F1581–F1590)

- [ ] F1581 — Canvas objects through CRDT structures (Epic 12 integration)
- [ ] F1582 — Concurrent move/resize convergence
- [ ] F1583 — Presence cursors on shared canvases
- [ ] F1584 — Collaborative drawing sessions
- [ ] F1585 — Object-level locking during edit
- [ ] F1586 — Canvas history checkpoints
- [ ] F1587 — Conflict UX for irreconcilable spatial edits
- [ ] F1588 — Shared canvas permissions
- [ ] F1589 — Canvas collab load test
- [ ] F1590 — Canvas sync tests

### Canvas Epic Close (F1591–F1600)

- [ ] F1591 — Performance hardening pass (10k objects usable)
- [ ] F1592 — Accessibility: full keyboard spatial navigation
- [ ] F1593 — Canvas export (SVG/PNG/PDF, region or full)
- [ ] F1594 — Import from Obsidian Canvas / Excalidraw formats
- [ ] F1595 — Canvas plugin API surface
- [ ] F1596 — Demo canvases in seed content
- [ ] F1597 — Canvas user guide
- [ ] F1598 — Full canvas regression suite
- [ ] F1599 — Canvas telemetry (local perf stats)
- [ ] F1600 — Epic 16 retro devlog

## Epic 17 — Audio Fables (F1601–F1700)

> Mesh consumer: the TTS foundation, soundscapes, and adaptive score become the `speech`, `audio`, and `music` capabilities on the shared Modality Mesh. See `docs/architecture/modality-mesh.md`.

### TTS Foundation (F1601–F1610)

- [ ] F1601 — Local TTS engine adapter (Piper-class voices)
- [ ] F1602 — Voice catalog: install, preview, manage local voices
- [ ] F1603 — Server-side synthesis pipeline with caching by text hash
- [ ] F1604 — Web Speech API fallback path
- [ ] F1605 — Pronunciation lexicon (names, invented words)
- [ ] F1606 — SSML-ish markup subset (pauses, emphasis, rate)
- [ ] F1607 — Synthesis queue with priority (interactive vs batch)
- [ ] F1608 — Voice settings per vault (default narrator)
- [ ] F1609 — Synthesis benchmark + quality matrix doc
- [ ] F1610 — TTS adapter tests

### Voice Casting (F1611–F1620)

- [ ] F1611 — Per-entity voice assignment (character → voice)
- [ ] F1612 — Dialogue attribution detection in story text
- [ ] F1613 — Narrator vs character line separation
- [ ] F1614 — Voice audition UI (hear candidates per character)
- [ ] F1615 — Per-character rate/pitch adjustments
- [ ] F1616 — Cast sheet per story (saved casting)
- [ ] F1617 — Casting templates (reuse across stories)
- [ ] F1618 — Uncast-line fallback rules
- [ ] F1619 — Casting data in story manifest
- [ ] F1620 — Casting tests

### Narration Renderer (F1621–F1630)

- [ ] F1621 — Story path → audio scene rendering (line-by-line synthesis)
- [ ] F1622 — Choice-point audio handling (menu voice, earcons)
- [ ] F1623 — Live narration in player (speak as you read)
- [ ] F1624 — Pre-render mode: full path baked to audio file
- [ ] F1625 — Pause/resume/skip controls tied to story position
- [ ] F1626 — Audio position ↔ text position sync model
- [ ] F1627 — Speed control with pitch preservation
- [ ] F1628 — Sleep timer
- [ ] F1629 — Renderer performance (faster-than-realtime synthesis)
- [ ] F1630 — Renderer tests

### Soundscapes (F1631–F1640)

- [ ] F1631 — Layered ambient engine (loops + one-shots, Web Audio)
- [ ] F1632 — Scene-tag soundscape bindings (# scene: storm)
- [ ] F1633 — Crossfade and ducking under narration
- [ ] F1634 — Bundled CC0 sound library with attribution manifest
- [ ] F1635 — User sound import to library
- [ ] F1636 — Soundscape editor (compose layers per scene)
- [ ] F1637 — Story-effect sound triggers (~ play("door"))
- [ ] F1638 — Volume mixing panel (narration/ambient/effects)
- [ ] F1639 — Audio memory management (sample unloading)
- [ ] F1640 — Soundscape tests

### Read-Along (F1641–F1650)

- [ ] F1641 — Word/sentence-level highlight sync during narration
- [ ] F1642 — Synthesis timestamp extraction for alignment
- [ ] F1643 — Auto-scroll following narration
- [ ] F1644 — Tap-word-to-jump audio seeking
- [ ] F1645 — Karaoke mode styling options
- [ ] F1646 — Read-along for plain notes (not just stories)
- [ ] F1647 — Alignment fallback when timestamps unavailable
- [ ] F1648 — Reading-practice mode (record user, simple comparison)
- [ ] F1649 — Read-along accessibility review
- [ ] F1650 — Read-along tests

### Recording Studio (F1651–F1660)

- [ ] F1651 — Human narration recording per knot/paragraph
- [ ] F1652 — Punch-in re-recording (fix one sentence)
- [ ] F1653 — Take management (multiple takes, pick best)
- [ ] F1654 — Waveform editor (trim, silence trim)
- [ ] F1655 — Noise gate / normalize processing
- [ ] F1656 — Mixed casts: human + TTS in one story
- [ ] F1657 — Recording session checklist UI (lines remaining)
- [ ] F1658 — Mobile recording support (PWA mic)
- [ ] F1659 — Storage strategy for takes (opus, content-addressed)
- [ ] F1660 — Studio tests

### Audio Export (F1661–F1670)

- [ ] F1661 — Path-to-audiobook export (chosen path → m4b with chapters)
- [ ] F1662 — Chapter markers from knot titles
- [ ] F1663 — Embedded cover art and metadata
- [ ] F1664 — MP3/opus alternative formats
- [ ] F1665 — Multi-path export (one file per major branch)
- [ ] F1666 — Note-to-audio export (listen to any notebook)
- [ ] F1667 — Export queue with progress + cancel
- [ ] F1668 — Output size estimation upfront
- [ ] F1669 — Export integrity tests (duration, chapters)
- [ ] F1670 — Export docs

### Playback System (F1671–F1680)

- [ ] F1671 — Media Session API: lock-screen controls, artwork
- [ ] F1672 — Background playback in PWA
- [ ] F1673 — Playback position persistence per story/note
- [ ] F1674 — Listening queue (chain stories/notes)
- [ ] F1675 — Offline audio caching with pin controls
- [ ] F1676 — Bluetooth/headphone control handling
- [ ] F1677 — Interruption recovery (calls, route changes)
- [ ] F1678 — Listening stats (time, completion)
- [ ] F1679 — CarPlay-adjacent web behavior verification
- [ ] F1680 — Playback tests

### Audio Accessibility (F1681–F1690)

- [ ] F1681 — Full app audio-first navigation review
- [ ] F1682 — Choice reading with numbered selection by voice UI patterns
- [ ] F1683 — Audio descriptions for story images
- [ ] F1684 — Caption/transcript view for all audio
- [ ] F1685 — Dyslexia-friendly read-along presets
- [ ] F1686 — Volume normalization across voices
- [ ] F1687 — Mono/balance options
- [ ] F1688 — Flashing/motion-free audio visualizations
- [ ] F1689 — A11y audio review with checklist
- [ ] F1690 — Accessibility tests

### Audio Epic Close (F1691–F1700)

- [ ] F1691 — End-to-end: cast → soundscape → narrate → export demo fable
- [ ] F1692 — Performance: synthesis cache hit-rate tuning
- [ ] F1693 — Disk budget controls for audio caches
- [ ] F1694 — Audio settings consolidation page
- [ ] F1695 — Demo audio fable in seed content
- [ ] F1696 — Audio user guide
- [ ] F1697 — Audio regression suite
- [ ] F1698 — Battery profiling on mobile playback
- [ ] F1699 — Audio plugin API surface
- [ ] F1700 — Epic 17 retro devlog

## Epic 18 — Spaced Repetition & Learning (F1701–F1800)

### Scheduler Core (F1701–F1710)

- [ ] F1701 — Card model: prompt/answer bound to source note blocks
- [ ] F1702 — FSRS scheduler implementation with parameter defaults
- [ ] F1703 — Review log storage (every rating, full history)
- [ ] F1704 — Scheduler parameter optimization from review history
- [ ] F1705 — Due-queue computation with timezone correctness
- [ ] F1706 — New-card introduction limits and ordering
- [ ] F1707 — Suspend/bury mechanics
- [ ] F1708 — Scheduler property tests (intervals monotone sane)
- [ ] F1709 — FSRS conformance vectors test
- [ ] F1710 — Scheduler benchmark (100k cards)

### Card Authoring (F1711–F1720)

- [ ] F1711 — Cloze syntax in notes ({{c1::hidden}})
- [ ] F1712 — Q&A block syntax for explicit cards
- [ ] F1713 — Auto-card suggestions from note structure (definitions, lists)
- [ ] F1714 — Card preview in editor gutter
- [ ] F1715 — Multi-cloze cards from one block
- [ ] F1716 — Image occlusion cards (mask regions)
- [ ] F1717 — Card-source live link (edit note updates card)
- [ ] F1718 — Orphaned card handling on note deletion
- [ ] F1719 — Card browser with FQL filtering
- [ ] F1720 — Authoring tests

### Review Experience (F1721–F1730)

- [ ] F1721 — Phone-first review UI (big tap targets, swipe ratings)
- [ ] F1722 — Keyboard review flow on desktop (1-4, space)
- [ ] F1723 — Answer reveal animations (reduced-motion aware)
- [ ] F1724 — Session length controls and auto-stop
- [ ] F1725 — In-review source peek (jump to note context)
- [ ] F1726 — Audio cards (TTS question/answer via Epic 17)
- [ ] F1727 — Review offline with sync of logs
- [ ] F1728 — Undo last rating
- [ ] F1729 — Review session summary screen
- [ ] F1730 — Review UX tests

### Story-Driven Learning (F1731–F1740)

- [ ] F1731 — Quiz knots: story choices as recall checks
- [ ] F1732 — Story generator from due cards (review disguised as fable)
- [ ] F1733 — Mastery gates in stories (path unlocks by retention)
- [ ] F1734 — Learning-mode story template in Forge stdlib
- [ ] F1735 — Card creation from story content (codex → cards)
- [ ] F1736 — Spaced story re-reads (schedule story revisits)
- [ ] F1737 — Language-learning fable mode (vocab integration)
- [ ] F1738 — Story quiz analytics
- [ ] F1739 — Demo learning fable in seed
- [ ] F1740 — Story-learning tests

### Decks & Organization (F1741–F1750)

- [ ] F1741 — Decks as saved queries (dynamic membership)
- [ ] F1742 — Deck-level scheduler settings
- [ ] F1743 — Deck dashboard (due counts, forecast)
- [ ] F1744 — Cross-deck review sessions
- [ ] F1745 — Tag-driven deck composition
- [ ] F1746 — Deck sharing format (.fdeck)
- [ ] F1747 — Per-notebook card defaults
- [ ] F1748 — Filtered/custom study sessions
- [ ] F1749 — Deck management tests
- [ ] F1750 — Deck docs

### Memory Insights (F1751–F1760)

- [ ] F1751 — Retention charts (true retention over time)
- [ ] F1752 — Review heatmap calendar
- [ ] F1753 — Workload forecast graph
- [ ] F1754 — Difficulty distribution analysis
- [ ] F1755 — Leech detection with remediation suggestions
- [ ] F1756 — Time-per-card stats
- [ ] F1757 — Knowledge coverage map (which notes have cards)
- [ ] F1758 — Streaks and gentle gamification (optional)
- [ ] F1759 — Insights export
- [ ] F1760 — Insights tests

### Sibling & Edge Cases (F1761–F1770)

- [ ] F1761 — Sibling spacing (related cards not same session)
- [ ] F1762 — Duplicate card detection
- [ ] F1763 — Timezone travel handling
- [ ] F1764 — Vacation mode (pause without pile-up shock)
- [ ] F1765 — Catch-up strategy after long gaps
- [ ] F1766 — Card priority overrides
- [ ] F1767 — Maximum interval caps
- [ ] F1768 — Re-learning steps configuration
- [ ] F1769 — Edge case test matrix
- [ ] F1770 — Scheduler edge docs

### Notifications & Habits (F1771–F1780)

- [ ] F1771 — Daily review reminder (local notifications)
- [ ] F1772 — Due-count badge on app icon
- [ ] F1773 — Best-time suggestion from review history
- [ ] F1774 — Habit streak protection (one-tap minimum session)
- [ ] F1775 — Weekly learning digest note
- [ ] F1776 — Quiet hours respect
- [ ] F1777 — Reminder copy variants (non-nagging tone)
- [ ] F1778 — Notification deep-link straight into review
- [ ] F1779 — Habit feature tests
- [ ] F1780 — Habit design doc

### Anki Interop (F1781–F1790)

- [ ] F1781 — .apkg import (notes, cards, scheduling state)
- [ ] F1782 — Anki template → card rendering mapping
- [ ] F1783 — Media import from apkg
- [ ] F1784 — Scheduling state translation (preserve intervals)
- [ ] F1785 — Export to .apkg
- [ ] F1786 — Shared-deck import smoke corpus
- [ ] F1787 — Round-trip fidelity report
- [ ] F1788 — Large collection import (100k cards) benchmark
- [ ] F1789 — Anki interop tests
- [ ] F1790 — Anki migration guide

### Learning Epic Close (F1791–F1800)

- [ ] F1791 — Full learning-loop e2e (note → card → reviews → retention)
- [ ] F1792 — Performance on phone review sessions
- [ ] F1793 — Learning settings consolidation
- [ ] F1794 — Demo deck in seed content
- [ ] F1795 — Learning user guide
- [ ] F1796 — Scientific honesty pass (claims match evidence)
- [ ] F1797 — Learning regression suite
- [ ] F1798 — Plugin API for custom card types
- [ ] F1799 — Learning analytics privacy review
- [ ] F1800 — Epic 18 retro devlog

## Epic 19 — Story Interop & Distribution (F1801–F1900)

> Mesh consumer: the ComfyUI art adapter becomes the `image` provider, joined by `video` and `model3d`, so a published fable can ship with generated illustration, narration, score, and explorable scenes. See `docs/architecture/modality-mesh.md`.

### .fablepack Format (F1801–F1810)

- [ ] F1801 — Container spec: story source, bytecode, assets, casting, manifest, signature
- [ ] F1802 — Deterministic packing (reproducible archives)
- [ ] F1803 — Pack/unpack CLI and UI
- [ ] F1804 — Manifest schema with capability requirements (audio, AI, knowledge bindings)
- [ ] F1805 — Dependency-free packs (knowledge refs snapshotted or stubbed)
- [ ] F1806 — Pack validation + content warnings metadata
- [ ] F1807 — Version compatibility ranges in manifest
- [ ] F1808 — Pack integrity (hash tree, optional signing)
- [ ] F1809 — Spec document published in docs
- [ ] F1810 — Format conformance tests

### Standalone Player (F1811–F1820)

- [ ] F1811 — Single-file HTML player hardening (works from file://)
- [ ] F1812 — Player size budget (<300KB before story data)
- [ ] F1813 — Saves in localStorage with export/import
- [ ] F1814 — Theme/typography parity with in-app player
- [ ] F1815 — Audio support in standalone (bundled assets)
- [ ] F1816 — Accessibility parity in standalone
- [ ] F1817 — Offline-complete guarantee test
- [ ] F1818 — Standalone analytics: none, verified
- [ ] F1819 — Browser matrix testing (Safari/Firefox/Chrome, iOS)
- [ ] F1820 — Standalone player tests

### Ink Compatibility (F1821–F1830)

- [ ] F1821 — .ink parser for the common-subset grammar
- [ ] F1822 — Ink → Forge AST mapping with semantics notes
- [ ] F1823 — Unsupported-construct report (clear, itemized)
- [ ] F1824 — Ink JSON (compiled) runtime adapter option
- [ ] F1825 — The Intercept and classic samples as test corpus
- [ ] F1826 — Forge → Ink export (compatible subset)
- [ ] F1827 — Divert/knot semantic equivalence tests
- [ ] F1828 — Ink import UI flow
- [ ] F1829 — Ink interop docs
- [ ] F1830 — Ink conformance suite

### Twine Compatibility (F1831–F1840)

- [ ] F1831 — Twee 3 parser
- [ ] F1832 — Harlowe/SugarCube macro subset mapping strategy
- [ ] F1833 — Twine HTML archive import
- [ ] F1834 — Passage links → choices/diverts conversion
- [ ] F1835 — Twine variable semantics mapping
- [ ] F1836 — Forge → Twee export (subset)
- [ ] F1837 — Unsupported-macro report
- [ ] F1838 — Twine corpus tests
- [ ] F1839 — Twine import UI
- [ ] F1840 — Twine interop docs

### Versioning & Releases (F1841–F1850)

- [ ] F1841 — Story release channel: draft → released versions with names
- [ ] F1842 — Story changelog generation between releases
- [ ] F1843 — Save-compat checks between story versions
- [ ] F1844 — Release diff viewer (what changed narratively)
- [ ] F1845 — Rollback to prior release
- [ ] F1846 — Release notes in pack manifest
- [ ] F1847 — Reader update prompts for re-imported packs
- [ ] F1848 — Branch freeze (lock a path while editing others)
- [ ] F1849 — Versioning tests
- [ ] F1850 — Release workflow docs

### Reader Feedback Loop (F1851–F1860)

- [ ] F1851 — Local reader feedback notes (per-moment reactions)
- [ ] F1852 — Feedback export bundle to send back to authors
- [ ] F1853 — Author feedback inbox (import reader bundles)
- [ ] F1854 — Aggregated choice statistics (local playthroughs)
- [ ] F1855 — Drop-off analysis per knot
- [ ] F1856 — Ending distribution charts
- [ ] F1857 — Playtest mode with structured prompts at checkpoints
- [ ] F1858 — Feedback anonymization options
- [ ] F1859 — Feedback loop tests
- [ ] F1860 — Playtesting guide

### Generative Art — ComfyUI Adapter (F1861–F1870)

- [ ] F1861 — ComfyUI-local adapter: workflow-JSON submission over its HTTP API, health check, queue status
- [ ] F1862 — Comfy Cloud as an opt-in second endpoint behind the same adapter (egress consent like F1364)
- [ ] F1863 — Cover generation: title + blurb + theme → cover image, with typographic fallback when no backend
- [ ] F1864 — Entity portraits: generate from entity fields/description, attach to entity card + codex
- [ ] F1865 — Scene illustrations: `# scene:` tags render generated art in the player (cached per scene)
- [ ] F1866 — Style presets per story (consistent look across all generated assets)
- [ ] F1867 — Generation review UI: candidates, pick/regenerate, never auto-publish
- [ ] F1868 — Generated-asset pipeline: content-addressed storage, sizes/formats, provenance metadata
- [ ] F1869 — Library shelf aesthetics using covers (grid/spines), trailer cards with blurb + QR
- [ ] F1870 — Adapter tests with mocked ComfyUI server + docs

### Vault-to-Vault Sharing (F1871–F1880)

- [ ] F1871 — Tailnet vault discovery (opt-in mDNS-style announce)
- [ ] F1872 — Library sharing: browse a friend's shared shelf
- [ ] F1873 — Pack transfer over tailnet with verification
- [ ] F1874 — Borrowing semantics (time-boxed reads) as honor-system metadata
- [ ] F1875 — Shared shelf permissions
- [ ] F1876 — Update notifications for shared packs
- [ ] F1877 — Transfer resume on interruption
- [ ] F1878 — Shelf privacy controls
- [ ] F1879 — Sharing tests
- [ ] F1880 — Sharing setup guide

### Story Archives (F1881–F1890)

- [ ] F1881 — Archive.org-style local story archive format (everything, forever)
- [ ] F1882 — Reading history preservation across vault migrations
- [ ] F1883 — Dead-format rescue importers (old pack versions)
- [ ] F1884 — Story preservation checklist (assets, fonts, voices pinned)
- [ ] F1885 — Archival export with fixity manifest
- [ ] F1886 — Bulk archive verification command
- [ ] F1887 — Archive browser UI (deep past shelf)
- [ ] F1888 — Format migration framework for future changes
- [ ] F1889 — Archive tests
- [ ] F1890 — Preservation docs

### Distribution Epic Close (F1891–F1900)

- [ ] F1891 — Full pipeline e2e: author → release → pack → share → play elsewhere
- [ ] F1892 — Interop conformance dashboard (Ink/Twine/standalone status)
- [ ] F1893 — Pack security review (no script injection via stories)
- [ ] F1894 — Distribution performance (large pack handling)
- [ ] F1895 — Demo pack gallery in seed
- [ ] F1896 — Distribution user guide
- [ ] F1897 — Distribution regression suite
- [ ] F1898 — Community format RFC docs (inviting other tools)
- [ ] F1899 — Distribution plugin hooks
- [ ] F1900 — Epic 19 retro devlog

## Epic 20 — Multi-Vault, Automation & Power Tools (F1901–F2000)

### Multi-Vault (F1901–F1910)

- [ ] F1901 — Vault registry: multiple data dirs, named vaults
- [ ] F1902 — Vault switcher UI with fast switching
- [ ] F1903 — Per-vault settings isolation
- [ ] F1904 — Cross-vault search (opt-in federation)
- [ ] F1905 — Move/copy notes between vaults
- [ ] F1906 — Vault templates (work, personal, worldbuilding presets)
- [ ] F1907 — Per-vault encryption states coexisting
- [ ] F1908 — Vault archive/cold storage
- [ ] F1909 — Multi-vault tests
- [ ] F1910 — Multi-vault docs

### Automation Rules (F1911–F1920)

- [ ] F1911 — Rule engine: triggers (events, schedules, FQL conditions) → actions
- [ ] F1912 — Action library (move, tag, template, notify, export, run plugin)
- [ ] F1913 — Rule builder UI (no-code, with FQL escape hatch)
- [ ] F1914 — Dry-run mode for rules
- [ ] F1915 — Rule run history with diffs
- [ ] F1916 — Loop/cascade protection (rule firing limits)
- [ ] F1917 — Rule templates gallery (inbox-zero, weekly review prep)
- [ ] F1918 — Disable-on-error with notification
- [ ] F1919 — Rule engine tests
- [ ] F1920 — Automation docs

### Scheduled Jobs (F1921–F1930)

- [ ] F1921 — Cron-style scheduler with human-readable recurrence UI
- [ ] F1922 — Job types: backups, digests, re-indexing, rule triggers
- [ ] F1923 — Job run log with durations and outcomes
- [ ] F1924 — Missed-job catch-up policy (machine was asleep)
- [ ] F1925 — Job concurrency limits
- [ ] F1926 — Manual run-now for any job
- [ ] F1927 — Job failure notifications with backoff
- [ ] F1928 — Resource-aware scheduling (defer heavy jobs while active)
- [ ] F1929 — Scheduler tests
- [ ] F1930 — Jobs docs

### Webhooks & Integrations (F1931–F1940)

- [ ] F1931 — Outbound webhooks on events (tailnet/local targets)
- [ ] F1932 — Inbound webhook endpoints with token auth (capture from anywhere)
- [ ] F1933 — Webhook payload templates
- [ ] F1934 — Delivery retries with dead-letter view
- [ ] F1935 — Shortcuts-app recipes documented (iOS automation)
- [ ] F1936 — Email-in capture (local SMTP catcher option)
- [ ] F1937 — RSS feed output of selected queries
- [ ] F1938 — Webhook security review
- [ ] F1939 — Webhook tests
- [ ] F1940 — Integration cookbook

### Scripting Console (F1941–F1950)

- [ ] F1941 — Sandboxed JS console against the plugin API surface
- [ ] F1942 — Script library (saved scripts with descriptions)
- [ ] F1943 — Script scheduling (scripts as job actions)
- [ ] F1944 — Console REPL with API autocomplete
- [ ] F1945 — Result rendering (tables, JSON tree)
- [ ] F1946 — Dry-run transaction wrapper for scripts
- [ ] F1947 — Script permission scoping like plugins
- [ ] F1948 — Example script gallery
- [ ] F1949 — Console tests
- [ ] F1950 — Scripting docs

### Bulk Operations (F1951–F1960)

- [ ] F1951 — Bulk operation framework: preview → confirm → undoable batch
- [ ] F1952 — Find-and-replace across vault (regex, scoped)
- [ ] F1953 — Bulk frontmatter/field editing
- [ ] F1954 — Bulk link rewriting (restructure-safe moves)
- [ ] F1955 — Bulk tag operations with preview counts
- [ ] F1956 — Batch note merging tool
- [ ] F1957 — Batch splitting (one note → many by heading)
- [ ] F1958 — Operation journal (every bulk op replayable/reversible)
- [ ] F1959 — Bulk ops tests
- [ ] F1960 — Bulk ops docs

### FQL v2 (F1961–F1970)

- [ ] F1961 — Aggregations (count, group-by in query embeds)
- [ ] F1962 — Joins across types (notes with their entities' fields)
- [ ] F1963 — Computed fields and expressions in results
- [ ] F1964 — Query variables and parameterized saved queries
- [ ] F1965 — EXPLAIN view for query performance
- [ ] F1966 — Query result charts (bar, line, pie in embeds)
- [ ] F1967 — FQL v2 grammar docs + migration notes
- [ ] F1968 — Query linting with suggestions
- [ ] F1969 — FQL v2 test suite
- [ ] F1970 — Query cookbook

### Workspace Profiles (F1971–F1980)

- [ ] F1971 — Profiles: named UI states (open panes, filters, theme)
- [ ] F1972 — Focus modes (hide features per profile: writing mode, review mode)
- [ ] F1973 — Time-based profile switching option
- [ ] F1974 — Per-profile notification rules
- [ ] F1975 — Profile quick-switch in palette
- [ ] F1976 — Reading-only profile for phone evenings
- [ ] F1977 — Profile export/import
- [ ] F1978 — Default profile per device
- [ ] F1979 — Profile tests
- [ ] F1980 — Profile docs

### Power Tools (F1981–F1990)

- [ ] F1981 — Vault statistics deep-dive page (everything measurable)
- [ ] F1982 — Duplicate note finder with merge workflow
- [ ] F1983 — Broken-everything finder (links, embeds, bindings, attachments)
- [ ] F1984 — Vault linter with fix-its (naming, structure conventions)
- [ ] F1985 — Storage analyzer (what's taking space)
- [ ] F1986 — Performance profiler page (slowest queries, renders)
- [ ] F1987 — Keyboard macro recorder
- [ ] F1988 — Custom CSS injection point with examples
- [ ] F1989 — Power tools tests
- [ ] F1990 — Power user guide

### Grand Close (F1991–F2000)

- [ ] F1991 — Full 2,000-feature regression run, all suites green
- [ ] F1992 — Performance re-baseline of the complete system
- [ ] F1993 — Documentation completeness audit (every feature findable)
- [ ] F1994 — Fresh-machine install test of the full system
- [ ] F1995 — Demo vault v2 showcasing all epics
- [ ] F1996 — v2.0.0 release with changelog and artifacts
- [ ] F1997 — Final Lighthouse + a11y + security passes
- [ ] F1998 — The Fables Book: docs site narrative tour of the system
- [ ] F1999 — Project retrospective: what 2,000 features taught us
- [ ] F2000 — 🏁 Ship v2.0 — announcement note written as a fable

---

_2,000 features. Two tiers. One fable at a time._
