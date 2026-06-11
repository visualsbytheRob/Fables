# FABLES — 1,000-Feature Build Plan

**Fables** is a personal Knowledge OS fused with an interactive fiction engine ("Fable Forge").
Your notes are the world. Your stories run on a compiler you own.

- **Architecture:** TypeScript pnpm monorepo. `apps/server` (Fastify + SQLite) and `apps/web` (Vite + React PWA). `packages/core` (domain), `packages/forge-dsl` (lexer/parser/compiler), `packages/forge-vm` (bytecode runtime), `packages/sync` (offline op-log sync), `packages/ui` (design system).
- **Deployment:** built remotely with Claude Code, cloned and run locally, served over the tailnet via `tailscale serve` (HTTPS via ts.net certs), installed as a PWA on iPhone.
- **Cadence:** 10 days × 100 features. ~11 days of credits = buffer day included.

## Execution Protocol (read me first, future sessions)

1. Find the **first unchecked** `- [ ]` feature below. That is where work resumes.
2. Implement features in order. A feature is **done** when: code exists, it compiles, relevant tests pass, and the box is checked `- [x]`.
3. Commit in batches of ~10 features (one group = one commit) with message `feat(day-N): FXXX–FYYY <group name>`. Push directly to `main` after every 2–3 commits (user's standing instruction, 2026-06-11).
4. Never skip ahead past an unchecked feature without marking it `- [~]` (deferred) with a one-line reason appended.
5. If a feature is obsolete because of an earlier implementation decision, mark `- [x]` with `(subsumed by FXXX)` appended.
6. Keep `pnpm test` and `pnpm build` green at every commit. Do not leave the tree broken at end of session.
7. Update the **Status** line below at the end of every session.

**Status:** Day 1 in progress. Last completed: F060. Next: F061.

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
- [ ] F061 — `apps/web`: Vite + React + TypeScript scaffold
- [ ] F062 — React Router setup with layout route + placeholder pages
- [ ] F063 — App shell: sidebar, top bar, main pane, responsive collapse
- [ ] F064 — Typed API client generated from shared route schemas
- [ ] F065 — TanStack Query setup with sensible cache defaults
- [ ] F066 — Global error boundary with friendly fallback + reload
- [ ] F067 — Suspense/loading skeleton primitives
- [ ] F068 — API base URL from env with dev proxy to server port
- [ ] F069 — Vitest + Testing Library smoke test rendering the shell
- [ ] F070 — `pnpm dev` runs server + web concurrently with one command

### Design System Base (F071–F080)
- [ ] F071 — `packages/ui`: CSS custom-property tokens (color, spacing, type scale, radii)
- [ ] F072 — Dark/light theme with system-preference detection + manual toggle
- [ ] F073 — Button, Input, Textarea, Select primitives
- [ ] F074 — Dialog, Popover, Tooltip primitives (accessible, focus-trapped)
- [ ] F075 — Toast/notification system
- [ ] F076 — Icon set wiring (lucide) with consistent sizing
- [ ] F077 — Command palette shell component (⌘K) with fuzzy filter
- [ ] F078 — Responsive breakpoints + container utilities
- [ ] F079 — Focus-visible styles and reduced-motion support
- [ ] F080 — `/playground` route rendering every primitive for visual QA

### API Conventions (F081–F090)
- [ ] F081 — Response envelope: `{ data }` / `{ error: { code, message } }`
- [ ] F082 — Cursor pagination convention with `limit`/`cursor` params
- [ ] F083 — Stable error code catalog shared between server and client
- [ ] F084 — Validation middleware: zod-checked params/query/body per route
- [ ] F085 — Route schema registry enabling typed client generation
- [ ] F086 — `/api/v1` version prefix and version negotiation header
- [ ] F087 — ETag support on GET endpoints for cache validation
- [ ] F088 — Response compression (gzip/brotli) for JSON payloads
- [ ] F089 — Light rate limiting tuned for single-user tailnet use
- [ ] F090 — Contract tests asserting envelope + pagination behavior

### Dev Experience & CI (F091–F100)
- [ ] F091 — GitHub Actions CI: install, lint, typecheck, test, build on push/PR
- [ ] F092 — Vitest workspace config running all package test suites
- [ ] F093 — Coverage reporting with per-package thresholds
- [ ] F094 — `pnpm typecheck` running project references build
- [ ] F095 — Bundle size check for web build with budget warning
- [ ] F096 — Pre-commit hook: lint-staged (eslint + prettier on staged files)
- [ ] F097 — Issue + PR templates
- [ ] F098 — `CONTRIBUTING.md` describing monorepo layout and commands
- [ ] F099 — VS Code workspace settings + recommended extensions file
- [ ] F100 — Day-1 retro note in `docs/devlog/day-01.md`

---

## Day 2 — Notes Core (F101–F200)

### Note CRUD API (F101–F110)
- [ ] F101 — `POST /notes` create with title, body, notebook
- [ ] F102 — `GET /notes/:id` fetch single note with metadata
- [ ] F103 — `GET /notes` list with pagination, sort (updated/created/title)
- [ ] F104 — `PATCH /notes/:id` partial update with optimistic concurrency (rev check)
- [ ] F105 — `DELETE /notes/:id` soft delete to trash
- [ ] F106 — `POST /notes/:id/restore` from trash
- [ ] F107 — Trash auto-purge policy (30 days) with manual empty endpoint
- [ ] F108 — Duplicate note endpoint preserving tags and notebook
- [ ] F109 — Bulk operations endpoint: move, tag, delete multiple notes
- [ ] F110 — CRUD integration tests covering happy paths and conflict cases

### Note Storage & Versioning (F111–F120)
- [ ] F111 — Note revision table: append-only snapshots on save
- [ ] F112 — Revision pruning policy (keep all <24h, daily afterward)
- [ ] F113 — `GET /notes/:id/revisions` list endpoint
- [ ] F114 — `GET /notes/:id/revisions/:rev` fetch specific revision
- [ ] F115 — Restore-to-revision endpoint creating a new head revision
- [ ] F116 — Content hashing to skip no-op revisions
- [ ] F117 — Word/character count stored per revision
- [ ] F118 — Note size guard with friendly error past limit
- [ ] F119 — Revision diff computation (server-side, word-level)
- [ ] F120 — Versioning unit tests including pruning edge cases

### Markdown Editor (F121–F130)
- [ ] F121 — CodeMirror 6 editor component with markdown language mode
- [ ] F122 — Syntax highlighting theme matching app dark/light themes
- [ ] F123 — Toolbar: bold, italic, heading, list, code, link, quote
- [ ] F124 — Keyboard shortcuts for all toolbar actions
- [ ] F125 — Smart lists: continue/indent/outdent with Tab/Shift-Tab
- [ ] F126 — Code block editing with language tag + nested highlighting
- [ ] F127 — Image paste → attachment upload → markdown link insertion
- [ ] F128 — Drag-and-drop file attach into editor
- [ ] F129 — Editor settings: font size, line width, vim-lite mode toggle
- [ ] F130 — Editor component tests (commands, list behavior)

### Markdown Rendering (F131–F140)
- [ ] F131 — Markdown → HTML pipeline (remark/rehype) with sanitization
- [ ] F132 — GFM support: tables, strikethrough, task lists, autolinks
- [ ] F133 — Syntax-highlighted code blocks in preview
- [ ] F134 — Task list checkboxes toggleable from preview (writes back to source)
- [ ] F135 — Footnotes and definition list support
- [ ] F136 — Math rendering (KaTeX) behind a setting
- [ ] F137 — Mermaid diagram rendering behind a setting
- [ ] F138 — Heading anchor links + in-note table of contents component
- [ ] F139 — Split view: editor | live preview with synced scroll
- [ ] F140 — Rendering snapshot tests for the full pipeline

### Notebooks & Organization (F141–F150)
- [ ] F141 — Notebook CRUD API with nesting (parent_id)
- [ ] F142 — Notebook tree sidebar with expand/collapse, drag to reorder
- [ ] F143 — Move note between notebooks (drag + command palette)
- [ ] F144 — Notebook icons + colors
- [ ] F145 — Default notebook setting for quick capture
- [ ] F146 — Notebook-level note count badges
- [ ] F147 — Archive notebook flag hiding it from default views
- [ ] F148 — Breadcrumb navigation for nested notebooks
- [ ] F149 — Notebook deletion with note re-homing flow
- [ ] F150 — Notebook tree tests (nesting, moves, cycles prevented)

### Tags (F151–F160)
- [ ] F151 — Tag CRUD API with rename propagation
- [ ] F152 — Inline `#tag` parsing from note bodies into tag index
- [ ] F153 — Tag autocomplete in editor on `#` trigger
- [ ] F154 — Tag sidebar section with counts
- [ ] F155 — Tag filter view: notes by tag with AND/OR combination
- [ ] F156 — Tag colors + emoji support
- [ ] F157 — Nested tags (`#world/characters`) with hierarchy view
- [ ] F158 — Merge tags operation
- [ ] F159 — Orphan tag cleanup job
- [ ] F160 — Tag parsing + propagation tests

### Attachments & Files (F161–F170)
- [ ] F161 — Attachment upload endpoint storing to `DATA_DIR/attachments` content-addressed
- [ ] F162 — Attachment metadata table: mime, size, hash, source note
- [ ] F163 — Image serving with on-the-fly resize variants
- [ ] F164 — Attachment garbage collection for unreferenced files
- [ ] F165 — File type allowlist + size limits with clear errors
- [ ] F166 — Image lightbox viewer in note preview
- [ ] F167 — PDF attachment inline preview
- [ ] F168 — Audio attachment player component
- [ ] F169 — Attachment manager view: all files, sizes, owning notes
- [ ] F170 — Attachment lifecycle tests (upload, GC, dedupe by hash)

### Note List & Navigation UI (F171–F180)
- [ ] F171 — Note list pane: title, snippet, updated time, tag chips
- [ ] F172 — Virtualized list for large notebooks
- [ ] F173 — Sort + filter bar (date, title, has-attachments, tag)
- [ ] F174 — Multi-select with bulk action toolbar
- [ ] F175 — Note context menu (open, duplicate, move, delete)
- [ ] F176 — Quick switcher (⌘P): fuzzy jump to any note
- [ ] F177 — Recent notes + pinned notes sections
- [ ] F178 — Pin/unpin note action
- [ ] F179 — Three-pane responsive layout collapsing gracefully to phone width
- [ ] F180 — Navigation flow tests (switcher, list selection, deep links)

### Autosave & History UX (F181–F190)
- [ ] F181 — Debounced autosave with saving/saved indicator
- [ ] F182 — Conflict detection on stale rev with merge prompt
- [ ] F183 — Revision history panel with timeline slider
- [ ] F184 — Side-by-side revision diff view
- [ ] F185 — One-click restore from history panel
- [ ] F186 — Local draft recovery from unexpected tab close (localStorage)
- [ ] F187 — Undo/redo depth beyond editor default, persisted per session
- [ ] F188 — "Unsaved changes" navigation guard
- [ ] F189 — Save status in command palette + keyboard force-save
- [ ] F190 — Autosave/conflict integration tests

### Power Features (F191–F200)
- [ ] F191 — Quick capture modal (global hotkey) creating note in default notebook
- [ ] F192 — Note templates v0: new-note-from-template picker
- [ ] F193 — Word count + reading time in status bar
- [ ] F194 — Focus mode: hide all chrome, typewriter scrolling
- [ ] F195 — Note export: single note → .md file download
- [ ] F196 — Copy note as markdown / as rendered HTML
- [ ] F197 — Note info panel: created, updated, counts, backlinks stub
- [ ] F198 — Keyboard shortcut cheat-sheet overlay (?)
- [ ] F199 — Command palette actions for every note operation
- [ ] F200 — Day-2 retro note in `docs/devlog/day-02.md`

---

## Day 3 — Linking, Graph & Queries (F201–F300)

### Wikilinks (F201–F210)
- [ ] F201 — `[[wikilink]]` syntax parsing in note bodies
- [ ] F202 — Link table maintenance on note save (source, target, position)
- [ ] F203 — Wikilink autocomplete in editor on `[[` trigger
- [ ] F204 — Click-to-navigate wikilinks in preview and editor
- [ ] F205 — `[[link|alias]]` display alias support
- [ ] F206 — Broken link styling + create-on-click for missing targets
- [ ] F207 — Heading-level links `[[note#heading]]`
- [ ] F208 — Block-level links `[[note^blockid]]` with block ID generation
- [ ] F209 — Link rename propagation when a note title changes
- [ ] F210 — Wikilink parser test suite (nesting, escapes, unicode)

### Backlinks (F211–F220)
- [ ] F211 — Backlinks API: incoming links for a note with context snippets
- [ ] F212 — Backlinks panel in note view grouped by source note
- [ ] F213 — Context snippet extraction around each backlink mention
- [ ] F214 — Backlink count badge on note list items
- [ ] F215 — Click backlink snippet → open source at exact position
- [ ] F216 — Backlinks for headings and blocks, not just whole notes
- [ ] F217 — Backlinks sort: by recency, by source notebook
- [ ] F218 — Backlinks panel collapse state persistence
- [ ] F219 — Link integrity job: detect and report orphaned link rows
- [ ] F220 — Backlinks API tests including snippet boundaries

### Unlinked Mentions (F221–F230)
- [ ] F221 — Unlinked mention detection: note titles appearing as plain text elsewhere
- [ ] F222 — Mention index updated incrementally on save
- [ ] F223 — Unlinked mentions section in backlinks panel
- [ ] F224 — One-click "link this mention" converting text to wikilink
- [ ] F225 — Bulk "link all mentions" action with preview
- [ ] F226 — Alias-aware mention detection (entity aliases match too)
- [ ] F227 — Case sensitivity + word-boundary rules with settings
- [ ] F228 — Mention scan performance budget: incremental, never full-table on save
- [ ] F229 — Exclusion rules (code blocks, URLs don't count as mentions)
- [ ] F230 — Mention detection test suite

### Graph Data API (F231–F240)
- [ ] F231 — Graph endpoint: nodes (notes/entities/stories) + edges (links)
- [ ] F232 — Graph filtering params: notebooks, tags, types, date range
- [ ] F233 — Local graph endpoint: n-hop neighborhood around one note
- [ ] F234 — Node degree + cluster metadata computed server-side
- [ ] F235 — Graph response caching with invalidation on link changes
- [ ] F236 — Orphan node detection (no links in or out)
- [ ] F237 — Edge weighting by link count between same pair
- [ ] F238 — Graph export endpoint (JSON, GraphML)
- [ ] F239 — Community detection (simple label propagation) for cluster coloring
- [ ] F240 — Graph API tests on seeded fixtures

### Graph View UI (F241–F250)
- [ ] F241 — Force-directed graph canvas (WebGL via pixi/sigma or d3+canvas)
- [ ] F242 — Pan/zoom/drag interactions, mobile pinch support
- [ ] F243 — Node styling by type (note/entity/story) and cluster color
- [ ] F244 — Hover highlight of node neighborhood, dim the rest
- [ ] F245 — Click node → preview popover; double-click → open note
- [ ] F246 — Graph filter toolbar bound to graph API params
- [ ] F247 — Local graph mode embedded in note view sidebar
- [ ] F248 — Graph search: type to locate and center a node
- [ ] F249 — Layout settings: gravity, link distance, freeze toggle
- [ ] F250 — Graph view performance test with 5k-node synthetic fixture

### Daily Notes & Journal (F251–F260)
- [ ] F251 — Daily note convention: one note per day-key in Journal notebook
- [ ] F252 — "Today" command creating/opening today's daily note
- [ ] F253 — Calendar widget navigating to any day's note
- [ ] F254 — Daily note template with configurable sections
- [ ] F255 — Streak indicator for consecutive journaling days
- [ ] F256 — Yesterday/tomorrow quick navigation in daily notes
- [ ] F257 — Automatic date heading + created-via-capture entries appended
- [ ] F258 — Week view: seven daily notes summarized
- [ ] F259 — On-this-day resurfacing of past years' entries
- [ ] F260 — Daily note flow tests

### Templates (F261–F270)
- [ ] F261 — Template notebook convention + template picker
- [ ] F262 — Template variables: `{{date}}`, `{{title}}`, `{{cursor}}`
- [ ] F263 — Custom variable prompts on instantiation
- [ ] F264 — Insert-template-at-cursor command (not just new note)
- [ ] F265 — Entity templates (character sheet, location sheet, item card)
- [ ] F266 — Story scene template for Forge authoring
- [ ] F267 — Template preview before instantiation
- [ ] F268 — Default template per notebook setting
- [ ] F269 — Template management UI (list, edit, duplicate)
- [ ] F270 — Template engine tests (variables, escaping)

### Query Language — FQL (F271–F280)
- [ ] F271 — FQL grammar v0: `tag:x notebook:y before:date "phrase"` filters
- [ ] F272 — FQL parser with helpful syntax error messages
- [ ] F273 — FQL → SQL compiler over the notes index
- [ ] F274 — Boolean operators AND/OR/NOT with grouping parens
- [ ] F275 — Field queries: title:, body:, has:attachment, linksto:[[note]]
- [ ] F276 — Date math: `updated:>7d`, `created:2026-06`
- [ ] F277 — Sort directives: `sort:updated desc`
- [ ] F278 — FQL query bar UI with syntax highlighting + completion
- [ ] F279 — FQL error recovery: partial results with warning chips
- [ ] F280 — FQL test suite: parser cases + SQL output snapshots

### Saved Queries & Embeds (F281–F290)
- [ ] F281 — Saved query CRUD: name, FQL string, icon
- [ ] F282 — Saved queries section in sidebar acting as smart folders
- [ ] F283 — Query embed block in notes: ```fql fenced block renders live results
- [ ] F284 — Embed result rendering: list, table, count modes
- [ ] F285 — Embed refresh policy + manual refresh control
- [ ] F286 — Dashboard note pattern: a note made of query embeds
- [ ] F287 — Saved query pinning to top bar
- [ ] F288 — Query result export (markdown table)
- [ ] F289 — Embed depth/recursion guards
- [ ] F290 — Saved query + embed integration tests

### Import & Export (F291–F300)
- [ ] F291 — Markdown folder import: directory of .md files → notebook, links resolved
- [ ] F292 — Obsidian vault import: wikilinks, frontmatter, attachments mapped
- [ ] F293 — Frontmatter handling: YAML metadata → tags/fields
- [ ] F294 — Import dry-run report before committing
- [ ] F295 — Full vault export: notebooks → folders of .md + attachments
- [ ] F296 — Export fidelity: round-trip import(export(x)) preserves links
- [ ] F297 — Import progress UI with per-file error reporting
- [ ] F298 — Duplicate handling strategy on import (skip/rename/merge)
- [ ] F299 — CLI import command for huge vaults (`pnpm fables import <dir>`)
- [ ] F300 — Day-3 retro note in `docs/devlog/day-03.md`

---

## Day 4 — Forge DSL: Language & Compiler Front-End (F301–F400)

### Language Specification (F301–F310)
- [ ] F301 — `docs/forge/spec.md`: language overview, design goals, file extension `.fable`
- [ ] F302 — Spec: scenes, passages, and the knot/stitch structural model
- [ ] F303 — Spec: choices syntax (`*` once-only, `+` sticky), nested choice depth
- [ ] F304 — Spec: variables, types (bool/number/string/list), declarations
- [ ] F305 — Spec: conditionals, expressions, operator precedence table
- [ ] F306 — Spec: diverts/jumps between scenes and stories
- [ ] F307 — Spec: tags, metadata blocks, author directives
- [ ] F308 — Spec: knowledge-base bindings (`@entity`, `@note` references) — the fusion hook
- [ ] F309 — Spec: includes/imports across .fable files
- [ ] F310 — Spec: formal grammar appendix (EBNF) kept in sync with parser

### Lexer (F311–F320)
- [ ] F311 — `packages/forge-dsl`: package scaffold with strict build + tests
- [ ] F312 — Token type definitions with source span tracking (line, col, offset)
- [ ] F313 — Lexer core: text content vs logic mode switching
- [ ] F314 — Tokenize structural markers: knots `===`, stitches `=`, choices `*`/`+`
- [ ] F315 — Tokenize logic: identifiers, numbers, strings with escapes, operators
- [ ] F316 — Tokenize diverts `->`, glue `<>`, tags `#`, comments `//` `/* */`
- [ ] F317 — Tokenize knowledge bindings `@entity(...)` and `[[note]]` refs
- [ ] F318 — Lexer error recovery: invalid char → error token, keep going
- [ ] F319 — Lexer fuzz harness: random input never throws, always terminates
- [ ] F320 — Lexer golden tests: fixture files → token stream snapshots

### Parser (F321–F330)
- [ ] F321 — Recursive descent parser producing typed AST with spans
- [ ] F322 — Parse story structure: header metadata, knots, stitches, content lines
- [ ] F323 — Parse choices with nesting depth, conditions, and labels
- [ ] F324 — Parse expressions: precedence climbing, unary/binary/ternary
- [ ] F325 — Parse logic lines: VAR/CONST declarations, assignments, function calls
- [ ] F326 — Parse diverts, tunnels (call/return), and end-of-flow markers
- [ ] F327 — Parse inline conditionals and alternatives (`{cond: a|b}`, sequences/cycles)
- [ ] F328 — Parse knowledge bindings into dedicated AST nodes
- [ ] F329 — Parser error recovery: sync points so one error doesn't cascade
- [ ] F330 — Parser golden tests: fixtures → AST JSON snapshots

### AST & Visitors (F331–F340)
- [ ] F331 — AST node type hierarchy with discriminated unions
- [ ] F332 — Visitor/walker utility with enter/exit hooks
- [ ] F333 — AST printer: AST → canonical source (basis for formatter)
- [ ] F334 — Span utilities: node → source excerpt for diagnostics
- [ ] F335 — AST query helpers: find-all-diverts, find-all-bindings, etc.
- [ ] F336 — Parent-pointer pass for upward traversal
- [ ] F337 — AST JSON serialization stable across versions
- [ ] F338 — Node factory helpers for tests and codegen tooling
- [ ] F339 — AST invariant checker (no orphan spans, valid parent chains)
- [ ] F340 — Visitor + printer round-trip tests

### Diagnostics Engine (F341–F350)
- [ ] F341 — Diagnostic type: severity, code, span, message, related spans
- [ ] F342 — Diagnostic catalog with stable codes (`FORGE001`…)
- [ ] F343 — Pretty terminal renderer: source frame with caret underlines
- [ ] F344 — JSON diagnostic output for editor integration
- [ ] F345 — Multi-error collection: compile never stops at first error
- [ ] F346 — Warnings: unreachable content, unused variables, empty choices
- [ ] F347 — Hints: did-you-mean suggestions for misspelled knot names
- [ ] F348 — Diagnostic suppression comments (`// forge-ignore FORGE012`)
- [ ] F349 — Severity configuration (promote warnings to errors)
- [ ] F350 — Diagnostics snapshot tests for every catalog code

### Symbol Resolution (F351–F360)
- [ ] F351 — Symbol table: knots, stitches, variables, labels with scopes
- [ ] F352 — Two-pass resolution: declare all, then resolve references
- [ ] F353 — Divert target resolution incl. cross-file targets
- [ ] F354 — Variable scope rules: global VAR, temp `~ temp`, choice-local
- [ ] F355 — Duplicate declaration detection with both spans reported
- [ ] F356 — Undefined reference errors with nearest-name suggestion
- [ ] F357 — Knowledge binding resolution against the notes/entities DB at compile time
- [ ] F358 — Include graph resolution with cycle detection
- [ ] F359 — Dead knot detection (unreachable from entry point)
- [ ] F360 — Resolution test suite incl. multi-file fixtures

### Semantic Checks (F361–F370)
- [ ] F361 — Type checking for expressions (bool/number/string/list)
- [ ] F362 — Condition expressions must be boolean — error with coercion hint
- [ ] F363 — List operations validity (membership, add/remove)
- [ ] F364 — Choice structure rules: no content after unconditional divert
- [ ] F365 — Once-only choice exhaustion analysis (possible dead ends flagged)
- [ ] F366 — Tunnel call/return pairing validation
- [ ] F367 — Const reassignment errors
- [ ] F368 — String interpolation expression validation
- [ ] F369 — Entity binding field checks (`@hero.health` exists on entity schema)
- [ ] F370 — Semantic check test suite

### Formatter (F371–F380)
- [ ] F371 — `forge fmt`: canonical formatting from AST printer
- [ ] F372 — Indentation rules for nested choices and gathers
- [ ] F373 — Logic line spacing + alignment conventions
- [ ] F374 — Comment preservation through format
- [ ] F375 — Idempotency guarantee: fmt(fmt(x)) === fmt(x), property-tested
- [ ] F376 — Range formatting (format selection only)
- [ ] F377 — `--check` mode for CI
- [ ] F378 — Format-on-save wiring in the web editor
- [ ] F379 — Formatter config: max width, choice marker style
- [ ] F380 — Formatter golden tests across fixture corpus

### Editor Integration (F381–F390)
- [ ] F381 — CodeMirror 6 language package for `.fable` (parser-backed)
- [ ] F382 — Syntax highlighting: structure, logic, strings, bindings, comments
- [ ] F383 — Live diagnostics in editor gutter + squiggles from compiler
- [ ] F384 — Autocomplete: knot names, variables, entity bindings
- [ ] F385 — Go-to-definition for diverts and variables
- [ ] F386 — Hover info: variable type, knot summary, entity preview
- [ ] F387 — Document outline panel (knots/stitches tree)
- [ ] F388 — Rename refactor for knots and variables
- [ ] F389 — Folding for knots and choice blocks
- [ ] F390 — Editor integration tests (completion, diagnostics overlay)

### Language Test Infrastructure (F391–F400)
- [ ] F391 — Fixture corpus: 20+ `.fable` programs from trivial to gnarly
- [ ] F392 — Golden test runner: lex/parse/resolve snapshots per fixture
- [ ] F393 — Error fixture corpus: programs that must produce specific diagnostics
- [ ] F394 — Property tests: printer/parser round-trip
- [ ] F395 — Fuzzer: grammar-aware random program generator
- [ ] F396 — Performance benchmark: 10k-line story compiles under budget
- [ ] F397 — Coverage gate for forge-dsl ≥ 90%
- [ ] F398 — Spec ↔ implementation conformance checklist doc
- [ ] F399 — `forge check` CLI command (compile-only, report diagnostics)
- [ ] F400 — Day-4 retro note in `docs/devlog/day-04.md`

---

## Day 5 — Compiler Back-End & VM (F401–F500)

### Intermediate Representation (F401–F410)
- [ ] F401 — `packages/forge-vm`: package scaffold
- [ ] F402 — IR design doc: flat container tree, instruction kinds
- [ ] F403 — AST → IR lowering for content and structure
- [ ] F404 — IR for expressions: stack-based operation sequence
- [ ] F405 — IR for choices: choice points with condition refs
- [ ] F406 — IR for diverts/tunnels: addresses + call-stack ops
- [ ] F407 — IR validation pass (well-formed addresses, no dangling refs)
- [ ] F408 — IR text dump format for debugging (`forge dump-ir`)
- [ ] F409 — IR optimization: constant folding, dead branch pruning
- [ ] F410 — Lowering test suite with IR snapshots

### Bytecode Format (F411–F420)
- [ ] F411 — Bytecode container spec: header, version, string table, instruction stream
- [ ] F412 — Opcode set definition (~40 ops) with operand encodings
- [ ] F413 — Serializer: IR → bytecode buffer
- [ ] F414 — Deserializer with version check + corruption detection (checksum)
- [ ] F415 — String/constant pool deduplication
- [ ] F416 — Source map section: instruction → source span for runtime errors
- [ ] F417 — Knowledge binding table section (entity/note refs by ID)
- [ ] F418 — Disassembler (`forge disasm`) producing readable listing
- [ ] F419 — Backward compatibility policy doc + version negotiation
- [ ] F420 — Round-trip tests: serialize → deserialize → identical execution

### Code Generation (F421–F430)
- [ ] F421 — Codegen for text output ops with interpolation
- [ ] F422 — Codegen for variable load/store, temp slots
- [ ] F423 — Codegen for arithmetic/logic/comparison expression ops
- [ ] F424 — Codegen for conditionals and inline alternatives (sequences, cycles, shuffles)
- [ ] F425 — Codegen for choice points incl. once-only visit tracking
- [ ] F426 — Codegen for diverts, tunnels, and story end
- [ ] F427 — Codegen for list operations
- [ ] F428 — Codegen for entity binding reads/writes
- [ ] F429 — Visit-count instrumentation (knot/stitch counters)
- [ ] F430 — Codegen golden tests: fixtures → disassembly snapshots

### VM Core (F431–F440)
- [ ] F431 — VM execution loop: fetch/decode/execute over bytecode
- [ ] F432 — Output buffer model: text fragments, line breaks, glue resolution
- [ ] F433 — `Continue()` semantics: run until choice point or end
- [ ] F434 — Choice presentation: gather available choices with evaluated conditions
- [ ] F435 — `ChooseIndex()` API resuming flow from selected choice
- [ ] F436 — Call stack for tunnels with depth limit + overflow diagnostics
- [ ] F437 — Runtime error model mapping back to source via source maps
- [ ] F438 — Step budget guard against infinite loops, configurable
- [ ] F439 — VM public API surface doc (`createStory`, `continue`, `choices`, `choose`)
- [ ] F440 — VM core tests driving fixture stories end-to-end

### State & Variables (F441–F450)
- [ ] F441 — Variable storage: globals map, temp frames, typed values
- [ ] F442 — Visit counts queryable from expressions (`visited(knot)`)
- [ ] F443 — Read-only external state injection (host-provided values)
- [ ] F444 — Variable observers: host callback on change (drives UI)
- [ ] F445 — List value semantics: ordered sets with origin tracking
- [ ] F446 — String interpolation evaluation at output time
- [ ] F447 — Turn counter + choice history in state
- [ ] F448 — State serialization: full VM state → JSON
- [ ] F449 — State deserialization with bytecode-version compatibility check
- [ ] F450 — State round-trip property tests (serialize mid-story, resume, identical transcript)

### Choices & Control Flow (F451–F460)
- [ ] F451 — Once-only choice consumption tracked in state
- [ ] F452 — Sticky choices remain across revisits
- [ ] F453 — Conditional choices evaluated lazily at presentation
- [ ] F454 — Fallback choice semantics (auto-taken when no others remain)
- [ ] F455 — Gather points re-converging branched flow
- [ ] F456 — Nested choice/gather depth handling (4+ levels)
- [ ] F457 — Choice text vs output text split (`[bracket]` syntax)
- [ ] F458 — Labeled choices referencable in conditions
- [ ] F459 — Divert-targets-as-values (variables holding destinations)
- [ ] F460 — Control flow torture tests (deep nesting, loops with exits)

### Saves & Snapshots (F461–F470)
- [ ] F461 — Save slot model: named snapshots of VM state + story metadata
- [ ] F462 — Save/load API endpoints per story per user
- [ ] F463 — Autosave on every choice with ring buffer of last N
- [ ] F464 — Rewind: restore to any point in choice history
- [ ] F465 — Save migration when story is recompiled (best-effort, with report)
- [ ] F466 — Transcript log: full text + choices made, exportable
- [ ] F467 — Save slot UI metadata: progress %, scene name, timestamp
- [ ] F468 — Cloud-of-one: saves synced through the op-log like notes
- [ ] F469 — Corrupt save detection + graceful recovery
- [ ] F470 — Save/rewind integration tests

### Randomness & Expressions (F471–F480)
- [ ] F471 — Seedable PRNG in VM state (deterministic replays)
- [ ] F472 — `RANDOM(min,max)` and dice expression support (`d20`, `3d6+2`)
- [ ] F473 — Shuffle alternatives using state PRNG
- [ ] F474 — Math stdlib: floor/ceil/abs/min/max/clamp
- [ ] F475 — String stdlib: upper/lower/contains/length
- [ ] F476 — List stdlib: count/min/max/random-from/intersection
- [ ] F477 — Replay determinism tests: same seed + same choices = same transcript
- [ ] F478 — Expression evaluator fuzz tests
- [ ] F479 — Stdlib reference doc generated from registry
- [ ] F480 — Dice roller UI affordance in player (tap to roll visibly)

### Effects & Host Hooks (F481–F490)
- [ ] F481 — External function registry: host functions callable from stories
- [ ] F482 — Effect ops: play-audio, set-theme, vibrate (mobile), pause
- [ ] F483 — Knowledge effects: `@journal(...)` writes a note entry from story flow
- [ ] F484 — Entity mutation effects (`~ @hero.health -= 10`) persisted to entity store
- [ ] F485 — Effect sandboxing: allowlist, no arbitrary host access
- [ ] F486 — Async host function support with VM suspend/resume
- [ ] F487 — Effect audit log per playthrough
- [ ] F488 — Effect failure handling: story-visible error values, no crashes
- [ ] F489 — Host hook API docs with examples
- [ ] F490 — Effects integration tests with mock host

### Debugger & Tooling (F491–F500)
- [ ] F491 — Step-through debugger API: step, step-over choice, inspect state
- [ ] F492 — Breakpoints on knots/stitches/lines
- [ ] F493 — Watch expressions evaluated against live state
- [ ] F494 — Debugger UI panel in authoring mode
- [ ] F495 — State inspector tree (variables, lists, visit counts, call stack)
- [ ] F496 — Time-travel: jump to any prior turn in debug session
- [ ] F497 — `forge run` CLI: play a story in the terminal
- [ ] F498 — `forge test` CLI: assert-script format for story unit tests
- [ ] F499 — VM performance benchmark suite (ops/sec, GC pressure)
- [ ] F500 — Day-5 retro note in `docs/devlog/day-05.md`

---

## Day 6 — Story Authoring & Player (F501–F600)

### Story Project Model (F501–F510)
- [ ] F501 — Story CRUD API: title, description, cover, entry file
- [ ] F502 — Multi-file story projects: .fable files tree per story
- [ ] F503 — Story file CRUD with rename + include-path integrity
- [ ] F504 — Compile-on-save pipeline with diagnostics persisted per story
- [ ] F505 — Story build status model: draft/valid/broken with error counts
- [ ] F506 — Story versioning: tagged releases of compiled bytecode
- [ ] F507 — Story settings: entry point, theme, PRNG seed mode
- [ ] F508 — Story duplication + template stories
- [ ] F509 — Story deletion with save-data warning flow
- [ ] F510 — Story project API tests

### Author Editor UX (F511–F520)
- [ ] F511 — Story workspace route: file tree + editor + preview three-pane
- [ ] F512 — Multi-tab editing of story files
- [ ] F513 — Compile status bar: errors/warnings count, click-to-jump
- [ ] F514 — Problems panel listing all diagnostics across files
- [ ] F515 — Quick-fix actions for common diagnostics (create missing knot, etc.)
- [ ] F516 — Story-wide search and replace across .fable files
- [ ] F517 — Snippet insertion palette (choice block, knot, conditional)
- [ ] F518 — Editor split view: two files side by side
- [ ] F519 — Autosave + dirty indicators per file tab
- [ ] F520 — Author workspace e2e test (edit → compile → error → fix)

### Scene Graph Visualization (F521–F530)
- [ ] F521 — Story flow graph: knots as nodes, diverts as edges (from IR)
- [ ] F522 — Graph layout: layered/dagre for narrative flow direction
- [ ] F523 — Node badges: choice count, word count, visit-tracking flags
- [ ] F524 — Click node → open knot in editor at line
- [ ] F525 — Unreachable knot highlighting in red
- [ ] F526 — Dead-end detection highlighting (no way to END)
- [ ] F527 — Path highlighting: trace all routes between two knots
- [ ] F528 — Story stats panel: word count, branch factor, depth, endings count
- [ ] F529 — Graph export as SVG/PNG for planning docs
- [ ] F530 — Scene graph tests on fixture stories

### Live Playtest Pane (F531–F540)
- [ ] F531 — Playtest pane running compiled story beside the editor
- [ ] F532 — Hot reload: recompile + smart restart preserving choice path when valid
- [ ] F533 — Replay-from-history after edits (re-applies prior choices)
- [ ] F534 — Jump-to-knot playtesting (start from any knot with state editor)
- [ ] F535 — State editor: set variables before/at any point in playtest
- [ ] F536 — Choice path recorder: save a path as a named test scenario
- [ ] F537 — Scenario runner: replay saved paths after changes, diff transcripts
- [ ] F538 — Playtest transcript view with per-line source attribution
- [ ] F539 — Mobile preview frame (iPhone viewport simulation)
- [ ] F540 — Playtest pane integration tests

### Player UI Core (F541–F550)
- [ ] F541 — Player route: distraction-free story reading flow
- [ ] F542 — Progressive text reveal with configurable pacing
- [ ] F543 — Choice buttons with tap targets sized for thumbs
- [ ] F544 — Story restart / continue-from-autosave entry flow
- [ ] F545 — In-player menu: saves, settings, exit, story info
- [ ] F546 — Variable-driven UI elements (stat bars bound to story variables)
- [ ] F547 — Inline images in story text (attachment refs)
- [ ] F548 — Player error boundary: runtime story errors render gracefully
- [ ] F549 — Reading position persistence per story
- [ ] F550 — Player core e2e test on a fixture story

### Player Presentation (F551–F560)
- [ ] F551 — Typography themes: serif book, terminal, parchment, dark
- [ ] F552 — Per-story theme override via story settings/tags
- [ ] F553 — Text size + line height reader controls
- [ ] F554 — Choice transition animations (subtle, reduced-motion aware)
- [ ] F555 — Scene-tag-driven backdrops (`# scene: forest` → ambient styling)
- [ ] F556 — Chapter/knot title cards on major transitions
- [ ] F557 — Paragraph-level text effects via tags (shake, whisper, emphasis)
- [ ] F558 — Reading width constraints tuned for phone vs desktop
- [ ] F559 — Theme gallery in settings with live preview
- [ ] F560 — Presentation snapshot tests

### History, Bookmarks & Rewind (F561–F570)
- [ ] F561 — Choice history drawer: every choice made this playthrough
- [ ] F562 — Tap any history entry → rewind to that point (uses F464)
- [ ] F563 — Bookmark current moment with note
- [ ] F564 — Bookmark list per story with jump-to
- [ ] F565 — Transcript reader mode: full playthrough as continuous text
- [ ] F566 — Transcript export → saved as a note in the knowledge base
- [ ] F567 — Branch explorer: after finishing, show % of content seen
- [ ] F568 — Endings collection: which endings reached, hints toggle
- [ ] F569 — Playthrough comparison view (two transcripts diffed)
- [ ] F570 — History/rewind integration tests

### Story Library (F571–F580)
- [ ] F571 — Library view: cover grid of all stories with progress badges
- [ ] F572 — Cover image generation: typographic covers from title + theme
- [ ] F573 — Story metadata editing: blurb, author, tags, content notes
- [ ] F574 — Library sort/filter: in-progress, finished, by tag
- [ ] F575 — Continue-reading rail surfacing most recent playthroughs
- [ ] F576 — Story detail page: blurb, stats, endings found, play button
- [ ] F577 — Reading stats: time read, choices made, per story and global
- [ ] F578 — Archived stories section
- [ ] F579 — Library search incl. blurb and tags
- [ ] F580 — Library e2e tests

### Export & Sharing (F581–F590)
- [ ] F581 — Export story source as zip of .fable files
- [ ] F582 — Export compiled story as standalone `.fable.bin`
- [ ] F583 — Self-contained HTML export: single file with embedded VM + story
- [ ] F584 — Import story from zip/bin with validation
- [ ] F585 — Export transcript as markdown/PDF
- [ ] F586 — Story JSON manifest for interop (title, files, checksum)
- [ ] F587 — Print stylesheet for transcripts
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
- [ ] F597 — Text-to-speech read-aloud mode (Web Speech API)
- [ ] F598 — TTS voice/rate settings + per-paragraph highlighting
- [ ] F599 — Accessibility pass on player (screen reader choice navigation)
- [ ] F600 — Day-6 retro note in `docs/devlog/day-06.md`

---

## Day 7 — The Fusion: Knowledge ↔ Story (F601–F700)

### Entity Notes (F601–F610)
- [ ] F601 — Entity model: typed notes (character/place/item/faction/custom) with schema fields
- [ ] F602 — Entity field schemas per type, user-editable (health: number, traits: list)
- [ ] F603 — Entity editor UI: structured fields + freeform markdown body
- [ ] F604 — Entity creation from templates (F265) wired to schemas
- [ ] F605 — Entity aliases for mention detection and story binding
- [ ] F606 — Entity relationship fields (ally-of, located-in) creating typed links
- [ ] F607 — Entity gallery views per type with card layouts
- [ ] F608 — Entity field validation + defaults from schema
- [ ] F609 — Entity API endpoints (CRUD + schema introspection for compiler F369)
- [ ] F610 — Entity model tests

### Codex Auto-Generation (F611–F620)
- [ ] F611 — Codex: auto-generated index note per story listing all bound entities
- [ ] F612 — Codex entries reveal progressively (only entities the reader has met)
- [ ] F613 — "Met" tracking: VM emits entity-encountered events into playthrough state
- [ ] F614 — Codex UI in player: slide-over panel, badge on new entries
- [ ] F615 — Codex entry view: entity card + story-specific revealed facts
- [ ] F616 — Revealed-facts model: story directives unlock entity field visibility
- [ ] F617 — Codex search and type filters
- [ ] F618 — Spoiler-safety rules: never show unrevealed fields
- [ ] F619 — Codex regeneration on recompile, stable entry IDs
- [ ] F620 — Codex behavior tests (reveal ordering, spoiler safety)

### Lore Embeds in Stories (F621–F630)
- [ ] F621 — `[[note]]` refs in story text render as tappable lore links in player
- [ ] F622 — Lore popover: note preview inside player without leaving the story
- [ ] F623 — `@entity.field` interpolation in story text pulls live entity values
- [ ] F624 — Compile-time validation that referenced notes/entities exist (F357)
- [ ] F625 — Stale-reference handling when a note is deleted post-compile
- [ ] F626 — Lore link styling distinct from choices (no accidental taps)
- [ ] F627 — Lore visit tracking: which lore the reader opened
- [ ] F628 — Author-side lore panel: all knowledge refs in current file
- [ ] F629 — Broken-binding diagnostics surfaced in problems panel
- [ ] F630 — Lore embed integration tests

### Story Events → Journal (F631–F640)
- [ ] F631 — `@journal()` effect (F483) writing structured entries to daily notes
- [ ] F632 — Journal entry template: story, scene, chosen text, timestamp
- [ ] F633 — Playthrough summary note auto-created on story completion
- [ ] F634 — Decision log: major choices (tagged by author) recorded as note entries
- [ ] F635 — Journal entries link back to exact story moment (deep link + state ref)
- [ ] F636 — Reader annotations: highlight story text → creates a linked note
- [ ] F637 — Annotation review view: all annotations across playthroughs
- [ ] F638 — Journal write batching to avoid noisy daily notes
- [ ] F639 — Privacy toggle: stories that may not write to the journal
- [ ] F640 — Journal effect tests

### Knowledge-Driven Conditions (F641–F650)
- [ ] F641 — Story conditions over knowledge state: `{ @note.exists("...") }`
- [ ] F642 — Conditions over entity fields: `{ @hero.health > 50 }` evaluated live
- [ ] F643 — Conditions over tags: content unlocked if reader has notes tagged X
- [ ] F644 — Read-only vs live binding modes (snapshot at start vs live queries)
- [ ] F645 — Binding evaluation caching per turn with invalidation
- [ ] F646 — Author preview: simulate knowledge state in playtest state editor (F535)
- [ ] F647 — Determinism guard: live bindings flagged in replay scenarios (F537)
- [ ] F648 — Permission model: stories declare which entities they may read/write
- [ ] F649 — Binding failure semantics: missing data → typed default + warning
- [ ] F650 — Knowledge-condition test matrix

### Timeline View (F651–F660)
- [ ] F651 — Unified timeline: notes created/edited + story events + playthroughs by day
- [ ] F652 — Timeline API with type filters and date windows
- [ ] F653 — Timeline UI: vertical scroll, day groupings, type icons
- [ ] F654 — Timeline item click-through to note/story moment
- [ ] F655 — In-story timelines: author-declared chronology (`# when: year 312`)
- [ ] F656 — Story-world timeline view per story from chronology tags
- [ ] F657 — Entity timelines: every event/mention involving an entity
- [ ] F658 — Timeline zoom levels (day/week/month/year)
- [ ] F659 — Timeline export as markdown chronicle note
- [ ] F660 — Timeline tests

### Cross-Reference Browser (F661–F670)
- [ ] F661 — Unified references panel: for any object, everything pointing at it (notes, stories, scenes, saves)
- [ ] F662 — Reference type grouping: wikilinks, bindings, mentions, journal entries
- [ ] F663 — Story → knowledge dependency report (everything a story reads/writes)
- [ ] F664 — Knowledge → story impact report (which stories break if this note changes)
- [ ] F665 — Impact warnings when editing/deleting bound notes or entities
- [ ] F666 — Cross-ref data layered into the global graph view (F241) with edge types
- [ ] F667 — Graph filter presets: "story web", "knowledge web", "fusion view"
- [ ] F668 — Reference counts in note/entity info panels
- [ ] F669 — Batch re-binding tool when renaming entities
- [ ] F670 — Cross-reference correctness tests

### Transclusion (F671–F680)
- [ ] F671 — Block transclusion: `![[note^block]]` embeds live block content in notes
- [ ] F672 — Note section transclusion: `![[note#heading]]`
- [ ] F673 — Entity card transclusion in notes: `![[@hero]]` renders entity card
- [ ] F674 — Query embeds in story author docs (FQL inside planning notes)
- [ ] F675 — Transclusion render depth limits + cycle detection
- [ ] F676 — Edit-in-place affordance on transcluded blocks
- [ ] F677 — Transclusion source attribution footer (hover reveals origin)
- [ ] F678 — Stale transclusion handling on source deletion
- [ ] F679 — Transclusion in story text (compile-time inlining with provenance)
- [ ] F680 — Transclusion tests incl. cycles

### World State Inspector (F681–F690)
- [ ] F681 — World dashboard: all entities with story-mutated fields highlighted
- [ ] F682 — Entity mutation history: which playthrough changed what, when
- [ ] F683 — Revert entity mutations per playthrough or per field
- [ ] F684 — World snapshots: name and save the entire entity state
- [ ] F685 — Snapshot diff view between two world states
- [ ] F686 — Sandbox mode: playthroughs against a snapshot, no real mutations
- [ ] F687 — Mutation conflict surfacing (two stories writing the same field)
- [ ] F688 — World state export/import as JSON
- [ ] F689 — World inspector tests
- [ ] F690 — Mutation audit retention policy + pruning

### Fusion Demo Content (F691–F700)
- [ ] F691 — Demo world: "The Aesop Engine" — notebook of fable entities (Fox, Crow, Lion...)
- [ ] F692 — Demo story 1: "The Fox & The Crow, Annotated" using lore embeds
- [ ] F693 — Demo story 2: branching fable using entity mutations + codex reveals
- [ ] F694 — Demo daily-note journal seeded with story-generated entries
- [ ] F695 — Demo saved queries + dashboard note showcasing FQL embeds
- [ ] F696 — Demo graph view arrangement that screenshots well
- [ ] F697 — Guided tour overlay: first-run walkthrough of the fusion features
- [ ] F698 — `pnpm seed:demo` one-command demo world install
- [ ] F699 — Demo content e2e test (compiles, plays, mutates, journals)
- [ ] F700 — Day-7 retro note in `docs/devlog/day-07.md`

---

## Day 8 — Search & Intelligence (F701–F800)

### Full-Text Search (F701–F710)
- [ ] F701 — SQLite FTS5 virtual table over notes (title, body) with porter stemming
- [ ] F702 — FTS index maintenance triggers on note create/update/delete
- [ ] F703 — Search endpoint with snippet + highlight offsets
- [ ] F704 — FTS over story source files and transcripts
- [ ] F705 — FTS over entity fields
- [ ] F706 — Phrase queries, prefix queries, NEAR operator support
- [ ] F707 — FTS ranking tuning (bm25 weights: title > body)
- [ ] F708 — Index rebuild command + consistency checker
- [ ] F709 — Search performance budget: <50ms at 10k notes, benchmarked
- [ ] F710 — FTS test suite

### Search UI (F711–F720)
- [ ] F711 — Global search overlay (⌘⇧F) with grouped results (notes/entities/stories)
- [ ] F712 — Result highlighting with matched-term emphasis
- [ ] F713 — Keyboard navigation through results
- [ ] F714 — Search filters bar wired to FQL (F271)
- [ ] F715 — Recent searches + suggested queries
- [ ] F716 — In-note find (⌘F) with match cycling
- [ ] F717 — Search result preview pane on desktop widths
- [ ] F718 — Empty/no-result states with query suggestions
- [ ] F719 — Search analytics (local-only): zero-result queries logged for tuning
- [ ] F720 — Search UI e2e tests

### Local Embeddings Pipeline (F721–F730)
- [ ] F721 — Embedding runtime: onnxruntime-node with a small sentence-transformer model
- [ ] F722 — Model download-on-first-use with checksum + offline fallback messaging
- [ ] F723 — Note chunking strategy: heading-aware chunks with overlap
- [ ] F724 — Embedding job queue: background indexing, debounced re-embeds on edit
- [ ] F725 — Embedding storage table keyed by chunk hash (skip unchanged)
- [ ] F726 — Batch embedding backfill command with progress reporting
- [ ] F727 — Embedding pipeline status in debug stats (queue depth, coverage %)
- [ ] F728 — CPU throttling: embedding work yields under interactive load
- [ ] F729 — Model swap support (re-embed-all migration path)
- [ ] F730 — Embedding pipeline tests with a tiny test model

### Vector Search (F731–F740)
- [ ] F731 — Vector store: sqlite-vec extension (or pure-JS fallback) for ANN queries
- [ ] F732 — Similarity search endpoint: top-k chunks for a query embedding
- [ ] F733 — Query embedding computed server-side on search
- [ ] F734 — Metadata filtering in vector search (notebook, type, date)
- [ ] F735 — Score normalization across cosine ranges
- [ ] F736 — ANN index parameters tuned + documented
- [ ] F737 — Vector search over story content and transcripts
- [ ] F738 — Nearest-neighbor dedupe candidates surfaced (near-identical notes)
- [ ] F739 — Vector search benchmark at 100k chunks
- [ ] F740 — Vector store tests incl. fallback path

### Hybrid Ranking (F741–F750)
- [ ] F741 — Hybrid search: reciprocal-rank fusion of FTS + vector results
- [ ] F742 — Mode toggle in search UI: keyword / semantic / hybrid
- [ ] F743 — Recency boost factor in final ranking
- [ ] F744 — Link-degree boost (well-connected notes rank slightly up)
- [ ] F745 — Per-type weighting (entities boosted for short name-like queries)
- [ ] F746 — Ranking explainability: debug panel showing score components
- [ ] F747 — Golden ranking tests: labeled query→expected-top-results fixtures
- [ ] F748 — Hybrid search latency budget enforced in benchmarks
- [ ] F749 — Fallback chain when embeddings unavailable (pure FTS, no errors)
- [ ] F750 — Hybrid pipeline tests

### Related Notes (F751–F760)
- [ ] F751 — Related panel in note view: semantic neighbors + shared-link neighbors
- [ ] F752 — Related entities for the current story scene in author mode
- [ ] F753 — "Relevant lore" suggestions while writing story text (binding suggestions)
- [ ] F754 — Related panel feedback: dismiss suggestion, don't show again
- [ ] F755 — Similar-note detection on create ("you may already have this")
- [ ] F756 — Related-notes caching + background refresh
- [ ] F757 — Cross-type relatedness (note ↔ story scene ↔ entity)
- [ ] F758 — Relatedness threshold settings
- [ ] F759 — Related panel perf: render under 100ms from cache
- [ ] F760 — Related suggestions tests

### Document Ingestion (F761–F770)
- [ ] F761 — PDF ingestion: text extraction → note with source attachment
- [ ] F762 — PDF page-anchored citations (note links back to page N)
- [ ] F763 — OCR pipeline (tesseract-wasm) for scanned PDFs/images
- [ ] F764 — EPUB ingestion → chaptered notes
- [ ] F765 — HTML/URL ingestion: readability extraction → markdown note
- [ ] F766 — Ingestion queue UI with per-item status and errors
- [ ] F767 — Auto-tagging ingested docs by source type
- [ ] F768 — Ingested docs auto-embedded + FTS-indexed
- [ ] F769 — Large file guardrails (page limits, size warnings)
- [ ] F770 — Ingestion pipeline tests with fixture documents

### Web Clipper (F771–F780)
- [ ] F771 — Clip endpoint: URL → readability-extracted markdown note
- [ ] F772 — Bookmarklet generator page for desktop browsers
- [ ] F773 — iOS share-sheet flow: PWA share target receiving URLs
- [ ] F774 — Clip with selection: highlighted text becomes the note body quote
- [ ] F775 — Image preservation in clips (downloaded as attachments)
- [ ] F776 — Clip metadata: source URL, site name, clipped-at, favicon
- [ ] F777 — Duplicate clip detection by URL
- [ ] F778 — Clip inbox notebook + triage workflow
- [ ] F779 — Clip failure handling (paywalls, JS-only pages) with raw fallback
- [ ] F780 — Clipper tests with fixture HTML

### Audio & Voice (F781–F790)
- [ ] F781 — Voice memo capture in PWA (MediaRecorder) saved as attachment
- [ ] F782 — Whisper.cpp integration hook: local transcription job runner
- [ ] F783 — Transcription queue with status + retry
- [ ] F784 — Transcript → note with timestamped segments linking to audio position
- [ ] F785 — Audio player with transcript follow-along highlighting
- [ ] F786 — Voice quick-capture: hold-to-record → transcribed into daily note
- [ ] F787 — Transcripts indexed in FTS + embeddings
- [ ] F788 — Speaker/segment heuristics (silence-based splitting)
- [ ] F789 — Transcription accuracy settings (model size selection)
- [ ] F790 — Voice pipeline tests with fixture audio

### Insights (F791–F800)
- [ ] F791 — Insights page: knowledge base stats, growth charts, orphan counts
- [ ] F792 — Note streaks + writing heatmap (GitHub-style)
- [ ] F793 — Stale important notes surfacing (high-degree, long-untouched)
- [ ] F794 — Suggested links digest: top unlinked-mention candidates weekly
- [ ] F795 — Reading insights: story time, completion rates, choice tendencies
- [ ] F796 — Dead-end content report (orphan notes, unreachable knots) unified
- [ ] F797 — Vault health score with actionable checklist
- [ ] F798 — Weekly digest note auto-generated (opt-in)
- [ ] F799 — Insights API tests
- [ ] F800 — Day-8 retro note in `docs/devlog/day-08.md`

---

## Day 9 — PWA, Offline, Sync & Tailscale (F801–F900)

### PWA Manifest & Install (F801–F810)
- [ ] F801 — Web app manifest: name, icons (maskable), theme colors, display standalone
- [ ] F802 — Full icon set generation pipeline (SVG source → all sizes)
- [ ] F803 — iOS-specific meta: apple-touch-icon, status bar style, splash screens
- [ ] F804 — Install prompt UX: instructions page for iOS Add-to-Home-Screen
- [ ] F805 — Standalone display detection + UI adjustments (safe areas, notch)
- [ ] F806 — App shortcuts in manifest (New Note, Today, Continue Reading)
- [ ] F807 — Share target registration (receives URLs/text → clipper F773)
- [ ] F808 — Orientation + viewport handling for reader vs editor
- [ ] F809 — PWA audit pass (Lighthouse PWA checklist green)
- [ ] F810 — Manifest/install smoke tests

### Service Worker (F811–F820)
- [ ] F811 — Service worker with Workbox: precache app shell on install
- [ ] F812 — Runtime caching: stale-while-revalidate for API GETs
- [ ] F813 — Cache-first strategy for attachments and fonts
- [ ] F814 — Offline fallback page for uncached routes
- [ ] F815 — SW update flow: new-version toast with refresh action
- [ ] F816 — Cache versioning + cleanup of stale caches on activate
- [ ] F817 — Compiled story bytecode cached for fully-offline play
- [ ] F818 — Cache size budget + eviction policy (LRU on attachments)
- [ ] F819 — SW bypass for debug endpoints and dev mode
- [ ] F820 — Service worker tests (Workbox strategy units + e2e offline check)

### Local Store — IndexedDB (F821–F830)
- [ ] F821 — IndexedDB layer (Dexie) mirroring notes, entities, story metadata
- [ ] F822 — Initial hydration: bulk pull into IDB on first connect
- [ ] F823 — Read-through pattern: UI reads IDB first, network refreshes
- [ ] F824 — IDB schema versioning + migrations
- [ ] F825 — Pending-writes outbox table for offline mutations
- [ ] F826 — Storage quota monitoring + persistence permission request
- [ ] F827 — Attachment lazy-caching: explicitly pinned notes cache their files
- [ ] F828 — Pin-for-offline UI on notes, notebooks, stories
- [ ] F829 — IDB wipe/repair tool in settings
- [ ] F830 — IDB layer unit tests

### Sync Protocol — Op Log (F831–F840)
- [ ] F831 — `packages/sync`: operation log design — every mutation is an op with lamport clock + device ID
- [ ] F832 — Server op-log table + `/sync/pull` since-cursor endpoint
- [ ] F833 — `/sync/push` endpoint: batch op ingestion with idempotency keys
- [ ] F834 — Client sync engine: push outbox, pull remote ops, apply to IDB
- [ ] F835 — Op schema per domain (note ops, entity ops, save-slot ops)
- [ ] F836 — Op compaction: server squashes old ops into snapshots
- [ ] F837 — Sync cursor persistence + resumable interrupted syncs
- [ ] F838 — Device registry: named devices with last-sync times
- [ ] F839 — Sync protocol doc with sequence diagrams
- [ ] F840 — Sync engine unit tests (interleaved op orders converge)

### Conflict Resolution (F841–F850)
- [ ] F841 — Conflict policy: field-level last-writer-wins with lamport ordering
- [ ] F842 — Note body conflicts: three-way text merge when clean
- [ ] F843 — Unresolvable body conflicts → conflict copy note + banner
- [ ] F844 — Conflict review UI: side-by-side, pick/merge/keep-both
- [ ] F845 — Entity field conflicts surfaced in world inspector (F681)
- [ ] F846 — Tombstone handling (delete vs concurrent edit)
- [ ] F847 — Save-slot conflicts: keep both with device labels
- [ ] F848 — Conflict metrics in debug stats
- [ ] F849 — Fuzz tests: random concurrent op sequences always converge
- [ ] F850 — Conflict UX e2e test

### Offline Editing UX (F851–F860)
- [ ] F851 — Offline indicator pill with pending-op count
- [ ] F852 — Full note editing offline (create/edit/tag) via outbox
- [ ] F853 — Offline story playing with local save slots
- [ ] F854 — Graceful degradation matrix: which features hide offline (search modes, embeddings)
- [ ] F855 — Reconnect burst: auto-sync with progress toast on connectivity return
- [ ] F856 — Background Sync API registration where supported
- [ ] F857 — Offline-created attachments queued for upload
- [ ] F858 — Clock skew tolerance in op ordering
- [ ] F859 — Airplane-mode e2e test scenario (edit offline → sync → verify)
- [ ] F860 — Offline UX polish pass on all empty/error states

### Sync Reliability (F861–F870)
- [ ] F861 — Exponential backoff + jitter on sync failures
- [ ] F862 — Partial batch failure handling (per-op acks)
- [ ] F863 — Sync health panel: last sync, op counts, error history
- [ ] F864 — Corrupt op quarantine instead of poison-pilling the queue
- [ ] F865 — Schema version negotiation between old clients and new server
- [ ] F866 — Rate limiting + batch size tuning for big sync bursts
- [ ] F867 — Data integrity check: client/server checksum comparison per table
- [ ] F868 — Forced full re-hydration recovery path
- [ ] F869 — Sync stress test: 10k pending ops drain correctly
- [ ] F870 — Chaos tests: kill connection mid-batch, verify no loss/dupes

### Notifications (F871–F880)
- [ ] F871 — Local notification service: in-app notification center
- [ ] F872 — Daily journal reminder (configurable time, local scheduling)
- [ ] F873 — Story update notices (new endings unlocked, scenario regressions)
- [ ] F874 — Sync problem alerts (conflicts need review)
- [ ] F875 — Web Push scaffolding for when iOS PWA push is available on tailnet
- [ ] F876 — Notification preferences per category
- [ ] F877 — Badge API: unread/pending counts on app icon where supported
- [ ] F878 — Quiet hours setting
- [ ] F879 — Notification center history with mark-read
- [ ] F880 — Notification tests

### Tailscale Integration (F881–F890)
- [ ] F881 — `docs/tailscale.md`: full setup guide — tailscale serve, ts.net HTTPS, iPhone install walkthrough with screenshots
- [ ] F882 — `scripts/serve.sh`: one command starting server + `tailscale serve` config
- [ ] F883 — Tailnet origin detection: server logs the https://*.ts.net URL on boot
- [ ] F884 — QR code printed in terminal + settings page for phone onboarding
- [ ] F885 — HTTPS-only checks: SW + clipboard + media features verified behind ts.net cert
- [ ] F886 — Optional auth layer: single-user token gate for defense-in-depth
- [ ] F887 — Session persistence: long-lived token cookie suitable for PWA
- [ ] F888 — `tailscale status` preflight in doctor script (F010)
- [ ] F889 — Funnel guidance doc (explicitly NOT enabled by default; risks explained)
- [ ] F890 — End-to-end tailnet checklist: fresh phone → installed PWA in <5 min

### Mobile Polish (F891–F900)
- [ ] F891 — Touch-target audit: all interactive elements ≥44px on phone
- [ ] F892 — Swipe gestures: back navigation, note list actions (archive/pin)
- [ ] F893 — Pull-to-refresh on list views triggering sync
- [ ] F894 — Keyboard avoidance: editor toolbar floats above iOS keyboard
- [ ] F895 — Haptics on key actions (save, sync complete, choice made)
- [ ] F896 — Bottom tab bar on phone widths (Notes / Stories / Search / Today)
- [ ] F897 — Phone-optimized editor mode (minimal toolbar, smart toolbar row)
- [ ] F898 — Landscape reading mode for player
- [ ] F899 — iOS quirk fixes: rubber-band scroll, 100vh, double-tap zoom suppression
- [ ] F900 — Day-9 retro note in `docs/devlog/day-09.md`

---

## Day 10 — Hardening, Tests, Perf & Ship (F901–F1000)

### Unit Test Sweep (F901–F910)
- [ ] F901 — Coverage audit: every package ≥85%, gaps ticketed and filled
- [ ] F902 — Core domain edge case tests (unicode titles, huge notes, empty states)
- [ ] F903 — Repository layer tests for every query path
- [ ] F904 — Compiler regression corpus: every past bug becomes a fixture
- [ ] F905 — VM regression corpus mirroring compiler corpus
- [ ] F906 — Sync property tests expanded (3+ devices, random partitions)
- [ ] F907 — API contract tests frozen as golden files
- [ ] F908 — Mutation testing trial on forge-dsl (Stryker) — fix weak tests
- [ ] F909 — Flaky test detection: 10x repeat run in CI weekly job
- [ ] F910 — Test runtime budget: full suite under 3 minutes

### End-to-End Tests (F911–F920)
- [ ] F911 — Playwright setup with server+web fixture harness and seeded data
- [ ] F912 — E2E: first-run onboarding → create note → link → graph shows edge
- [ ] F913 — E2E: author story → compile error → fix → playtest → finish
- [ ] F914 — E2E: fusion loop — story mutates entity → journal entry → codex reveal
- [ ] F915 — E2E: search flows (keyword, semantic-off fallback, FQL)
- [ ] F916 — E2E: offline edit → reconnect → sync → conflict resolution
- [ ] F917 — E2E: PWA install assets + offline shell load (headless approximation)
- [ ] F918 — E2E: import Obsidian fixture vault → verify links/attachments
- [ ] F919 — Mobile viewport e2e suite (iPhone dimensions, touch events)
- [ ] F920 — E2E suite in CI with trace artifacts on failure

### Performance (F921–F930)
- [ ] F921 — Performance budget doc: startup <2s, route nav <200ms, search <100ms
- [ ] F922 — Web bundle analysis: code-split routes, lazy-load graph/editor/player
- [ ] F923 — Server cold-start profiling + optimization
- [ ] F924 — SQLite tuning pass: indexes audited against query plans (EXPLAIN)
- [ ] F925 — Virtualization audit on all long lists
- [ ] F926 — Image loading: lazy, sized, AVIF/WebP variants
- [ ] F927 — Synthetic 10k-note vault benchmark suite in CI (nightly)
- [ ] F928 — Memory leak hunt: long-session heap snapshots on editor + player
- [ ] F929 — Graph view frame-rate target: 60fps at 2k nodes, fixes as needed
- [ ] F930 — Perf regression gate comparing benchmark results to baseline

### Accessibility (F931–F940)
- [ ] F931 — Axe automated scan integrated into e2e suite, zero violations
- [ ] F932 — Full keyboard navigation audit (every feature mouse-free)
- [ ] F933 — Screen reader pass: landmarks, labels, live regions for sync/toasts
- [ ] F934 — Player accessibility: choices as proper buttons, text reveal respect for AT
- [ ] F935 — Color contrast audit across both themes (AA minimum)
- [ ] F936 — Reduced-motion audit: all animations gated
- [ ] F937 — Focus management on route changes and dialogs
- [ ] F938 — Form error announcement patterns
- [ ] F939 — Font scaling resilience (200% zoom usable)
- [ ] F940 — Accessibility statement doc

### Security (F941–F950)
- [ ] F941 — Threat model doc for a tailnet-deployed single-user app
- [ ] F942 — Markdown/HTML sanitization audit (XSS via notes, clips, story text)
- [ ] F943 — SQL injection audit: all queries parameterized, verified by grep + tests
- [ ] F944 — Path traversal audit on attachment serving
- [ ] F945 — Story VM sandbox audit: effects allowlist (F485) penetration cases
- [ ] F946 — Dependency audit + lockfile policy + `pnpm audit` in CI
- [ ] F947 — Security headers: CSP, X-Content-Type-Options, frame-ancestors
- [ ] F948 — Upload content-type sniffing protections
- [ ] F949 — Token auth hardening (F886): constant-time compare, rotation command
- [ ] F950 — Secrets scan hook + history check

### Backup & Restore (F951–F960)
- [ ] F951 — Scheduled backup job: nightly SQLite snapshot + attachments manifest
- [ ] F952 — Backup retention policy (7 daily, 4 weekly, 6 monthly)
- [ ] F953 — One-file backup archive format (.fablesbak = tar.zst)
- [ ] F954 — Restore command with pre-restore safety snapshot
- [ ] F955 — Backup verification: restore-and-checksum test on every backup
- [ ] F956 — Backup settings UI: location, schedule, last-success status
- [ ] F957 — Backup failure notifications (F871)
- [ ] F958 — Export-everything: full vault + stories + saves as portable archive
- [ ] F959 — Disaster recovery doc: machine died, restore on new machine
- [ ] F960 — Backup/restore integration tests

### Migrations & Upgrades (F961–F970)
- [ ] F961 — App version display + changelog page in settings
- [ ] F962 — DB migration dry-run + automatic pre-migration backup
- [ ] F963 — Bytecode version upgrade path: recompile-all command
- [ ] F964 — IDB client migration coordination with server version
- [ ] F965 — Downgrade protection: refuse to open newer-schema DB with clear message
- [ ] F966 — Update checker against GitHub releases (manual, no auto-update)
- [ ] F967 — `pnpm upgrade-fables` script: pull, install, migrate, restart
- [ ] F968 — Data format documentation for all on-disk formats
- [ ] F969 — Migration test harness: seeded old-version DBs upgraded in CI
- [ ] F970 — Rollback runbook doc

### Local Analytics (F971–F980)
- [ ] F971 — Local-only usage stats: feature counters, no network egress ever
- [ ] F972 — Stats dashboard: most-used features, busiest hours
- [ ] F973 — Knowledge growth metrics over time (notes, links, words)
- [ ] F974 — Story metrics: plays, completion funnel per story
- [ ] F975 — Performance telemetry (local): slow ops log with percentiles
- [ ] F976 — Error aggregation view: recent client+server errors grouped
- [ ] F977 — Analytics data retention + purge controls
- [ ] F978 — Opt-out toggle disabling all collection
- [ ] F979 — Analytics privacy doc (everything stays on your machine)
- [ ] F980 — Analytics tests

### Documentation (F981–F990)
- [ ] F981 — Docs site: VitePress under `docs/` served at `/docs` route
- [ ] F982 — User guide: notes, linking, graph, daily flow
- [ ] F983 — Forge language tutorial: zero to first story in 10 steps
- [ ] F984 — Forge language reference generated from spec + stdlib registry
- [ ] F985 — Fusion cookbook: 10 recipes (codex, journal effects, world state…)
- [ ] F986 — Architecture doc with diagrams (monorepo map, data flow, sync)
- [ ] F987 — API reference generated from route schemas
- [ ] F988 — Troubleshooting guide (tailscale, sync, migrations)
- [ ] F989 — In-app help: contextual ? links into docs site
- [ ] F990 — Docs build in CI with link checker

### Release & Ship (F991–F1000)
- [ ] F991 — Production build pipeline: single `pnpm build` → `dist/` runnable artifact
- [ ] F992 — `pnpm start` production mode: one process serving API + web + docs
- [ ] F993 — systemd unit + launchd plist templates for run-on-boot
- [ ] F994 — Install script: clone → build → doctor → serve, fully guided
- [ ] F995 — Version 1.0.0 tag + generated changelog from commit history
- [ ] F996 — GitHub release with build artifact + checksums
- [ ] F997 — Final Lighthouse pass: PWA + perf + a11y + best practices ≥90
- [ ] F998 — Final fresh-machine install test following only the README
- [ ] F999 — Project retrospective doc: what 1,000 features taught us
- [ ] F1000 — 🎉 Ship it: README badge, screenshots, demo GIFs, v1.0 announcement note

---

*1,000 features. 10 days. One fable at a time.*
