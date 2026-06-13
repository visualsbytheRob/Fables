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

**Status:** Day 6 authoring done (F501–F540 + F462-3, F499). 1,154 tests green. Next: F541 player UI, then F561–F600.

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
- [ ] F883 — Tailnet origin detection: server logs the https://\*.ts.net URL on boot
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

_Tier 1 ends here. Tier 2 — ten stretch epics — begins below._

# TIER 2 — Stretch Epics (F1001–F2000)

Ten genuinely new subsystems. Same rules: in order, boxes checked with implementation,
green tree at every commit. Epics assume Tier 1 is complete.

## Epic 11 — Plugin & Extension Architecture (F1001–F1100)

### Plugin Manifest & Loader (F1001–F1010)

- [ ] F1001 — Plugin manifest spec: id, version, permissions, entry, UI contributions
- [ ] F1002 — Plugin directory layout under `DATA_DIR/plugins/<id>`
- [ ] F1003 — Manifest validation with versioned schema
- [ ] F1004 — Plugin loader: discover, validate, register at boot
- [ ] F1005 — Enable/disable plugins without restart
- [ ] F1006 — Plugin dependency declarations + load ordering
- [ ] F1007 — Semver compatibility checks against app version
- [ ] F1008 — Broken plugin quarantine (load failure never breaks boot)
- [ ] F1009 — Plugin registry persistence (installed, enabled, settings)
- [ ] F1010 — Loader test suite with fixture plugins

### Sandboxed Runtime (F1011–F1020)

- [ ] F1011 — Plugin code runs in isolated worker threads, never the main process
- [ ] F1012 — Structured RPC bridge between host and plugin worker
- [ ] F1013 — CPU/memory budgets per plugin with kill-on-exceed
- [ ] F1014 — No filesystem/network access except via granted capability APIs
- [ ] F1015 — Capability grant model bound to manifest permissions
- [ ] F1016 — Plugin crash isolation + auto-restart with backoff
- [ ] F1017 — Timeout handling on all plugin calls
- [ ] F1018 — Audit log of capability use per plugin
- [ ] F1019 — Sandbox escape test suite (adversarial fixtures)
- [ ] F1020 — Runtime performance overhead benchmark

### Notes API for Plugins (F1021–F1030)

- [ ] F1021 — Read API: query notes/tags/links with FQL from plugins
- [ ] F1022 — Write API: create/update notes with attribution metadata
- [ ] F1023 — Plugin-defined virtual notes (computed content)
- [ ] F1024 — Markdown post-processor hook (transform rendered output)
- [ ] F1025 — Custom block types registered by plugins (```myblock fences)
- [ ] F1026 — Tag and metadata APIs
- [ ] F1027 — Search extension hook (plugins add result sources)
- [ ] F1028 — Rate limits + batching on plugin data access
- [ ] F1029 — Change subscription API (watch note events)
- [ ] F1030 — Notes API contract tests

### Story/VM API for Plugins (F1031–F1040)

- [ ] F1031 — External function registration from plugins into the Forge VM
- [ ] F1032 — Custom story effects contributed by plugins
- [ ] F1033 — Compiler diagnostic contributions (custom lint rules)
- [ ] F1034 — Story export format plugins
- [ ] F1035 — Player UI overlays from plugins (stat widgets)
- [ ] F1036 — VM state read access with story-scoped permission
- [ ] F1037 — Pre/post choice hooks
- [ ] F1038 — Plugin-provided stdlib extensions with namespacing
- [ ] F1039 — Determinism guard: plugin functions declared pure vs effectful
- [ ] F1040 — Story API contract tests

### UI Extension Points (F1041–F1050)

- [ ] F1041 — Sidebar panel contribution API
- [ ] F1042 — Command palette command contributions
- [ ] F1043 — Note context-menu item contributions
- [ ] F1044 — Editor toolbar button contributions
- [ ] F1045 — Settings page sections per plugin
- [ ] F1046 — Custom routes/pages registered by plugins
- [ ] F1047 — Status bar item contributions
- [ ] F1048 — Theme contributions (full token sets)
- [ ] F1049 — UI contribution sandboxing (iframe/portal isolation)
- [ ] F1050 — Extension point e2e tests

### Event Hooks & Filters (F1051–F1060)

- [ ] F1051 — Typed event bus exposed to plugins (note.saved, story.completed…)
- [ ] F1052 — Filter chains: plugins transform data in defined pipelines
- [ ] F1053 — Hook priority + ordering controls
- [ ] F1054 — Async hook support with timeout budgets
- [ ] F1055 — Event replay protection (idempotency keys)
- [ ] F1056 — Hook failure isolation (one bad filter never corrupts the chain)
- [ ] F1057 — Event documentation generator from registry
- [ ] F1058 — Hook performance profiler per plugin
- [ ] F1059 — Wildcard subscriptions with permission gating
- [ ] F1060 — Event system test suite

### Permissions & Settings UX (F1061–F1070)

- [ ] F1061 — Install-time permission review screen
- [ ] F1062 — Runtime permission prompts for escalations
- [ ] F1063 — Per-plugin settings storage with schema-driven forms
- [ ] F1064 — Permission revocation without uninstall
- [ ] F1065 — Plugin detail page: permissions, resource use, audit trail
- [ ] F1066 — Notebook-scoped data access grants
- [ ] F1067 — Privacy labels (what data the plugin touches)
- [ ] F1068 — Bulk plugin management UI
- [ ] F1069 — Permission model documentation
- [ ] F1070 — Permission enforcement tests

### Plugin Dev Kit (F1071–F1080)

- [ ] F1071 — `pnpm create-plugin` scaffold command
- [ ] F1072 — Typed SDK package (@fables/plugin-sdk)
- [ ] F1073 — Hot-reload during plugin development
- [ ] F1074 — Plugin test harness with mock host
- [ ] F1075 — Dev mode inspector (RPC traffic, events, perf)
- [ ] F1076 — SDK documentation site section
- [ ] F1077 — Plugin packaging command (.fplugin archive)
- [ ] F1078 — Signature/checksum on packaged plugins
- [ ] F1079 — Example-driven tutorial: build a word-count plugin
- [ ] F1080 — SDK semver/compat test matrix

### Example Plugins (F1081–F1090)

- [ ] F1081 — Word-count & writing-stats plugin
- [ ] F1082 — Pomodoro/focus timer plugin with note logging
- [ ] F1083 — Weather-in-daily-note plugin (network capability demo)
- [ ] F1084 — Dice-roller story effect plugin (VM extension demo)
- [ ] F1085 — Custom theme pack plugin
- [ ] F1086 — Mood tracker with chart panel
- [ ] F1087 — Readwise-style highlights importer plugin
- [ ] F1088 — Story achievement system plugin
- [ ] F1089 — Each example doubles as SDK integration test
- [ ] F1090 — Example gallery page in docs

### Distribution (F1091–F1100)

- [ ] F1091 — File-based install: drop .fplugin, app offers install
- [ ] F1092 — Install from URL (tailnet/HTTPS) with checksum verification
- [ ] F1093 — Update detection + one-click plugin updates
- [ ] F1094 — Plugin export/backup with vault backups
- [ ] F1095 — Compatibility report before update (API usage scan)
- [ ] F1096 — Uninstall with data cleanup options
- [ ] F1097 — Trusted-source allowlist
- [ ] F1098 — Plugin catalog page (local registry of known plugins)
- [ ] F1099 — Distribution security review
- [ ] F1100 — Epic 11 retro devlog

## Epic 12 — Real-Time Collaboration & CRDT (F1101–F1200)

### CRDT Core (F1101–F1110)

- [ ] F1101 — CRDT engine integration (Yjs) in packages/sync
- [ ] F1102 — Note body as Y.Text with markdown semantics preserved
- [ ] F1103 — CRDT ↔ op-log bridge (Tier 1 sync stays canonical for non-collab data)
- [ ] F1104 — Garbage collection / tombstone compaction policy
- [ ] F1105 — Snapshot + update encoding for storage efficiency
- [ ] F1106 — CRDT document versioning and migration
- [ ] F1107 — Offline edits merge through CRDT on reconnect
- [ ] F1108 — Convergence property tests (random concurrent ops)
- [ ] F1109 — Memory benchmarks on large documents
- [ ] F1110 — CRDT core test suite

### Collaborative Editor (F1111–F1120)

- [ ] F1111 — CodeMirror binding to Y.Text (shared editing)
- [ ] F1112 — Remote cursor rendering with user colors
- [ ] F1113 — Remote selection highlights
- [ ] F1114 — Typing presence indicators
- [ ] F1115 — Undo/redo scoped to local user's edits
- [ ] F1116 — Cursor-stable view during remote edits
- [ ] F1117 — Conflict-free task list toggling
- [ ] F1118 — Collaborative editing latency budget (<100ms perceived)
- [ ] F1119 — Editor degradation when peer connection drops
- [ ] F1120 — Collab editor e2e tests (two simulated clients)

### Sync Server (F1121–F1130)

- [ ] F1121 — WebSocket collab endpoint with room-per-document
- [ ] F1122 — Update broadcast with backpressure handling
- [ ] F1123 — Room lifecycle: create, idle timeout, persistence flush
- [ ] F1124 — Reconnection with state vector catch-up
- [ ] F1125 — Per-room authorization checks
- [ ] F1126 — Server-side update persistence batching
- [ ] F1127 — Room metrics in debug stats
- [ ] F1128 — Horizontal readiness: room state externalizable
- [ ] F1129 — Load test: 20 concurrent editors on one note
- [ ] F1130 — Sync server test suite

### Presence & Awareness (F1131–F1140)

- [ ] F1131 — Awareness protocol: who's viewing/editing what
- [ ] F1132 — Avatar stack on open documents
- [ ] F1133 — Vault-level presence sidebar (active now)
- [ ] F1134 — Follow mode: jump to a collaborator's view
- [ ] F1135 — Idle/away detection
- [ ] F1136 — Per-device presence identity (named devices)
- [ ] F1137 — Presence privacy toggle
- [ ] F1138 — Awareness state cleanup on disconnect
- [ ] F1139 — Presence event hooks for plugins
- [ ] F1140 — Awareness tests

### Sharing & Invites (F1141–F1150)

- [ ] F1141 — Share model: per-note/notebook grants to named devices/users
- [ ] F1142 — Tailnet share links with scoped tokens
- [ ] F1143 — Read-only vs edit permission levels
- [ ] F1144 — Share management UI (who has access to what)
- [ ] F1145 — Link expiry and revocation
- [ ] F1146 — Guest identity (name + color) for link visitors
- [ ] F1147 — Shared-with-me view
- [ ] F1148 — Access audit log
- [ ] F1149 — Permission enforcement tests across sync + collab paths
- [ ] F1150 — Sharing e2e tests

### Collaborative Stories (F1151–F1160)

- [ ] F1151 — Shared story-file editing via CRDT
- [ ] F1152 — Compile coordination (one compiler run per change burst)
- [ ] F1153 — Shared playtest sessions: synchronized story state
- [ ] F1154 — Vote-on-choice mode for group play
- [ ] F1155 — Author/playtester role split in shared sessions
- [ ] F1156 — Live diagnostics visible to all editors
- [ ] F1157 — Story session chat sidebar
- [ ] F1158 — Spectator mode for live readings
- [ ] F1159 — Group-play session recording to transcript
- [ ] F1160 — Collab story tests

### Comments & Suggestions (F1161–F1170)

- [ ] F1161 — Anchored comments on note ranges (CRDT-stable anchors)
- [ ] F1162 — Comment threads with resolve state
- [ ] F1163 — Suggestion mode: proposed edits with accept/reject
- [ ] F1164 — Comment notifications in notification center
- [ ] F1165 — Comments on story knots in author mode
- [ ] F1166 — Comment search and filters
- [ ] F1167 — Comment export with note export
- [ ] F1168 — Anchor survival through heavy edits (tests)
- [ ] F1169 — Emoji reactions on comments
- [ ] F1170 — Comments test suite

### Merge & History in Collab (F1171–F1180)

- [ ] F1171 — Named versions on shared docs (manual checkpoints)
- [ ] F1172 — Attribution view: who wrote what (per-character authorship)
- [ ] F1173 — Time-slider playback of document history
- [ ] F1174 — Restore checkpoint with collaborator confirmation
- [ ] F1175 — Diff view between checkpoints
- [ ] F1176 — Revision pruning policy for CRDT history
- [ ] F1177 — Export attribution data
- [ ] F1178 — History performance on year-old documents
- [ ] F1179 — Forensic recovery tool (extract content from raw updates)
- [ ] F1180 — History tests

### Conflict-Free Structures (F1181–F1190)

- [ ] F1181 — Entity fields as CRDT maps (concurrent field edits merge)
- [ ] F1182 — Notebook tree as CRDT (concurrent moves resolve sanely)
- [ ] F1183 — Tag operations made commutative
- [ ] F1184 — Canvas objects as CRDT (positions merge)
- [ ] F1185 — Save-slot collision handling in shared stories
- [ ] F1186 — Cross-structure transaction semantics documented
- [ ] F1187 — Migration of Tier 1 data into CRDT-backed forms
- [ ] F1188 — Fallback path: collab disabled still fully functional
- [ ] F1189 — Structure convergence fuzz tests
- [ ] F1190 — Structures test suite

### Collab Hardening (F1191–F1200)

- [ ] F1191 — Three-device chaos test (partitions, clock skew, kill -9)
- [ ] F1192 — Bandwidth budget on phone connections
- [ ] F1193 — Battery impact audit on mobile PWA
- [ ] F1194 — Security review of room auth and share tokens
- [ ] F1195 — Data integrity checksums across collab + sync paths
- [ ] F1196 — Collab health diagnostics page
- [ ] F1197 — Graceful single-user mode when server unreachable
- [ ] F1198 — Docs: collaboration setup and mental model
- [ ] F1199 — Full collab e2e suite in CI
- [ ] F1200 — Epic 12 retro devlog

## Epic 13 — Encrypted Vault & Security Tier (F1201–F1300)

### Crypto Core (F1201–F1210)

- [ ] F1201 — libsodium integration with audited primitive choices documented
- [ ] F1202 — Key derivation: Argon2id from passphrase with tuned params
- [ ] F1203 — Master key / data key hierarchy (rotate data keys cheaply)
- [ ] F1204 — Authenticated encryption helpers (XChaCha20-Poly1305)
- [ ] F1205 — Secure memory handling (zeroing, no key logging)
- [ ] F1206 — Crypto module API with misuse-resistant design
- [ ] F1207 — Known-answer tests against reference vectors
- [ ] F1208 — Constant-time comparison utilities
- [ ] F1209 — Crypto parameter versioning for future upgrades
- [ ] F1210 — Crypto core test suite

### Encrypted Storage (F1211–F1220)

- [ ] F1211 — Encrypted vault mode: note bodies/titles encrypted at rest
- [ ] F1212 — Searchable metadata strategy documented (what stays plaintext and why)
- [ ] F1213 — Encrypted FTS approach: in-memory index built post-unlock
- [ ] F1214 — Encrypted attachments with streaming encrypt/decrypt
- [ ] F1215 — Vault conversion: plaintext → encrypted migration with verification
- [ ] F1216 — Decrypt-on-read caching with memory bounds
- [ ] F1217 — Write-path encryption with crash-safe ordering
- [ ] F1218 — Encrypted backup format (.fablesbak v2)
- [ ] F1219 — Performance benchmark: encrypted vs plaintext vault
- [ ] F1220 — Encrypted storage tests

### Key Management UX (F1221–F1230)

- [ ] F1221 — Vault unlock screen with passphrase entry
- [ ] F1222 — Recovery codes generated at vault creation
- [ ] F1223 — Passphrase change flow (re-wrap, not re-encrypt)
- [ ] F1224 — WebAuthn/passkey unlock where available
- [ ] F1225 — Unlock session duration settings
- [ ] F1226 — Wrong-passphrase rate limiting with backoff
- [ ] F1227 — Key fingerprint display for device verification
- [ ] F1228 — Emergency export with explicit re-auth
- [ ] F1229 — Forgotten passphrase = data loss messaging (honest UX)
- [ ] F1230 — Key management flow tests

### Lock Behavior (F1231–F1240)

- [ ] F1231 — Auto-lock on idle (configurable)
- [ ] F1232 — Lock on PWA background/visibility change option
- [ ] F1233 — Locked-state UI: nothing sensitive rendered or cached
- [ ] F1234 — In-memory state purge on lock
- [ ] F1235 — Quick-unlock PIN with device-bound wrapping key
- [ ] F1236 — Panic lock command (palette + URL)
- [ ] F1237 — Lock status indicator everywhere
- [ ] F1238 — Pending-edit preservation across lock (encrypted holding pen)
- [ ] F1239 — Lock behavior on multiple tabs coordinated
- [ ] F1240 — Lock tests incl. memory inspection assertions

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

- [ ] F1251 — Encrypted op-log payloads (server stores ciphertext)
- [ ] F1252 — Encrypted CRDT updates for collab on encrypted docs
- [ ] F1253 — Device key exchange for multi-device vaults
- [ ] F1254 — Device authorization flow (QR + fingerprint verify)
- [ ] F1255 — Revoked-device key rotation
- [ ] F1256 — Encrypted share grants (wrapped keys per recipient)
- [ ] F1257 — Metadata minimization in sync envelopes
- [ ] F1258 — E2E property: server compromise reveals no content (test)
- [ ] F1259 — Encrypted sync performance benchmarks
- [ ] F1260 — Encrypted sync tests

### Hardening (F1261–F1270)

- [ ] F1261 — CSP tightened to strict-dynamic with nonce
- [ ] F1262 — Subresource integrity on all assets
- [ ] F1263 — Clipboard hygiene (auto-clear copied secrets)
- [ ] F1264 — Screenshot/screen-recording warnings on secret notes (where detectable)
- [ ] F1265 — Memory-safe attachment preview pipeline
- [ ] F1266 — Dependency supply-chain audit + pinning policy
- [ ] F1267 — Fuzzing pass on all parsers (markdown, FQL, .fable, imports)
- [ ] F1268 — Server-side request forgery guards on clipper/import URLs
- [ ] F1269 — Security headers verification suite
- [ ] F1270 — Hardening regression tests

### Threat Modeling & Audit (F1271–F1280)

- [ ] F1271 — Threat model v2 covering collab, plugins, encryption
- [ ] F1272 — Attack tree for vault compromise paths
- [ ] F1273 — Plugin permission escalation analysis
- [ ] F1274 — Self-audit checklist run + findings fixed
- [ ] F1275 — Crypto design doc for external review
- [ ] F1276 — Privacy data-flow map (what leaves the machine: nothing)
- [ ] F1277 — Incident response runbook (corruption, key loss, device theft)
- [ ] F1278 — Secure defaults review (everything safe out of the box)
- [ ] F1279 — Penetration test scenarios as e2e suite
- [ ] F1280 — Audit documentation set

### Compliance-Grade Features (F1281–F1290)

- [ ] F1281 — Full vault wipe with verification
- [ ] F1282 — Data inventory export (everything stored, machine-readable)
- [ ] F1283 — Retention policies per notebook (auto-purge)
- [ ] F1284 — Tamper-evident audit log (hash chain)
- [ ] F1285 — Read receipts opt-out everywhere
- [ ] F1286 — Legal hold mode (freeze deletions)
- [ ] F1287 — Redaction tool (true content removal from history)
- [ ] F1288 — Export with redactions applied
- [ ] F1289 — Compliance feature documentation
- [ ] F1290 — Compliance feature tests

### Security Epic Close (F1291–F1300)

- [ ] F1291 — Full-suite security regression run
- [ ] F1292 — Performance re-baseline with encryption enabled
- [ ] F1293 — Encrypted vault disaster recovery drill (scripted)
- [ ] F1294 — Documentation: security model for normal humans
- [ ] F1295 — Documentation: security model for experts
- [ ] F1296 — Default-mode decision: encryption opt-in flow polished
- [ ] F1297 — Migration guides between all vault modes
- [ ] F1298 — Security FAQ
- [ ] F1299 — Epic security sign-off checklist
- [ ] F1300 — Epic 13 retro devlog

## Epic 14 — Local AI Co-Writer & Intelligence (F1301–F1400)

### Local Model Runtime (F1301–F1310)

- [ ] F1301 — Ollama adapter: detect, list models, health check
- [ ] F1302 — llama.cpp server adapter as alternative backend
- [ ] F1303 — Backend abstraction: one interface, pluggable engines
- [ ] F1304 — Model capability registry (context size, speed class)
- [ ] F1305 — Streaming token output through server to UI
- [ ] F1306 — Request queue with cancellation
- [ ] F1307 — Resource guardrails (no AI when battery/CPU constrained, configurable)
- [ ] F1308 — Model download guidance UI (not bundled)
- [ ] F1309 — Zero-AI graceful mode: every feature optional
- [ ] F1310 — Runtime adapter tests with mock backend

### Prompt Infrastructure (F1311–F1320)

- [ ] F1311 — Prompt template system with typed slots
- [ ] F1312 — Context budget manager (fit notes into model context)
- [ ] F1313 — Template library versioned in-repo
- [ ] F1314 — Per-task model routing (small for tags, big for prose)
- [ ] F1315 — Response schema validation (JSON tasks re-asked on parse failure)
- [ ] F1316 — Prompt/response logging (local, inspectable, off by default)
- [ ] F1317 — User-editable prompt overrides
- [ ] F1318 — Determinism settings (temperature presets per task)
- [ ] F1319 — Prompt regression harness with golden outputs
- [ ] F1320 — Prompt infra tests

### Vault Q&A — RAG (F1321–F1330)

- [ ] F1321 — Ask-your-vault: question → retrieval (Tier 1 hybrid search) → grounded answer
- [ ] F1322 — Citation rendering: every claim links to source notes
- [ ] F1323 — Retrieval tuning UI (scope to notebooks/tags)
- [ ] F1324 — Conversation memory within a Q&A session
- [ ] F1325 — Answer confidence signal (retrieval coverage heuristic)
- [ ] F1326 — "No good sources" honest refusal path
- [ ] F1327 — Q&A history saved as searchable notes (opt-in)
- [ ] F1328 — Follow-up question suggestions
- [ ] F1329 — RAG quality eval set (50 labeled Q→A pairs over demo vault)
- [ ] F1330 — RAG pipeline tests

### Note Intelligence (F1331–F1340)

- [ ] F1331 — Summarize note/notebook commands
- [ ] F1332 — Auto-tag suggestions with one-tap accept
- [ ] F1333 — Title suggestions for untitled notes
- [ ] F1334 — Link suggestions: AI-proposed wikilinks with context
- [ ] F1335 — Outline generation from messy notes
- [ ] F1336 — Rewrite tools: tighten, expand, change tone
- [ ] F1337 — Meeting-note structurer (actions, decisions extracted)
- [ ] F1338 — Weekly review draft generation from journal
- [ ] F1339 — All intelligence actions undoable + clearly attributed
- [ ] F1340 — Note intelligence tests

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

### Reader-Side AI (F1361–F1370)

- [ ] F1361 — Recap generation when resuming a story
- [ ] F1362 — Spoiler-safe hint system in player
- [ ] F1363 — Reading-level adaptation mode (same story, simpler prose)
- [ ] F1364 — Translation mode for story text (local model)
- [ ] F1365 — Post-story discussion questions generator
- [ ] F1366 — Personalized story recommendations from reading history
- [ ] F1367 — Reader AI features fully opt-in per story
- [ ] F1368 — Author controls: allow/deny reader-side AI transforms
- [ ] F1369 — Reader AI honesty: transformed text clearly labeled
- [ ] F1370 — Reader AI tests

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

### Cover Art & Presentation (F1861–F1870)

- [ ] F1861 — Cover studio: typographic cover designer (fonts, palettes, motifs)
- [ ] F1862 — Procedural cover motifs from story tags
- [ ] F1863 — Cover image import with safe-area guides
- [ ] F1864 — Library shelf aesthetics (spines, stacks view)
- [ ] F1865 — Story trailer cards (shareable image with blurb + QR)
- [ ] F1866 — Open Graph metadata in exports
- [ ] F1867 — Print-style title pages in transcripts/PDF
- [ ] F1868 — Cover asset pipeline (sizes, formats)
- [ ] F1869 — Cover studio tests
- [ ] F1870 — Presentation docs

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
