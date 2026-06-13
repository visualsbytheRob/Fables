# Fables Architecture

This document describes the architecture of Fables: a personal Knowledge OS fused with an interactive fiction engine. Read this to understand the system's structure, data flow, and deployment model.

## System Overview

Fables is a pnpm monorepo with two applications and five domain packages:

```
Fables/
├── apps/
│   ├── server/         Fastify + SQLite API server
│   └── web/            Vite + React PWA
├── packages/
│   ├── core/           Shared domain types & utilities
│   ├── forge-dsl/      The Fable language: lexer, parser, compiler
│   ├── forge-vm/       Bytecode VM: story playback engine
│   ├── sync/           Op-log: offline-first sync protocol
│   └── ui/             Design system primitives
└── docs/               User & contributor guides
```

## Data Model

Fables models two distinct domains that fuse together:

### Knowledge Domain

**Notes** are the primary unit. Every note has:
- `id`: ULID (sortable unique ID)
- `title`, `body`: markdown text
- `notebookId`: parent folder
- `tags`: inline `#tag` annotations parsed from body
- `attachments`: images, PDFs, audio files
- `links`: wikilinks `[[to other notes]]` and backlinks (reverse index)
- `revisions`: immutable snapshots on save (pruned: keep 24h full, then daily)

**Notebooks** are folders with nesting. Each note belongs to exactly one.

**Entities** are special typed notes (character/place/item/faction/custom) with structured fields defined per type (e.g., "health" as a number, "traits" as a list). Entity instances can be mutated by story effects.

**Tags** are extracted from note bodies and aggregated in a tag index. Tag changes propagate when note titles change (rename-affecting-tags scenario).

### Story Domain

**Stories** are authored in `.fable` files (the Forge language). Each story has:
- `id`: ULID
- `entryFile`: which `.fable` file starts execution
- `sources`: multi-file projects (can INCLUDE other .fables)
- `compiled`: bytecode blob (result of compilation)
- `metadata`: theme, title, entry knot, PRNG seed mode

**Compiled stories** are snapshots of bytecode linked to entity/note bindings. Recompiling invalidates old saves.

**Playthroughs** capture:
- `saveSlots`: named checkpoints (auto-saves + user saves)
- `transcripts`: the full choice path and text output
- `variables`: story state (variables, visit counts, random seed)

### The Fusion Layer

The **knowledge ↔ story** connection happens in three directions:

1. **Story reads knowledge:** `[[lore]]` refs and `@entity.field` bindings evaluated at runtime.
2. **Story writes knowledge:** `@journal(...)` effects write entries to daily notes; `@entity.health -= 10` mutates entities.
3. **Knowledge drives conditions:** story flow can branch on `{ @hero.health > 50 }` or `{ has-notes-tagged #magic }`.

At compile time, the Forge compiler resolves knowledge references (F357). At runtime, the VM host injects knowledge state.

## Server (apps/server)

**Fastify** REST API server. Runs on a single machine, serves the built web app.

### Data Storage

**SQLite with WAL + foreign keys.** All repos follow a pattern:

```typescript
class NotesRepo {
  create(note: NewNote): Result<Note, AppError> { }
  get(id: NoteId): Result<Note | null, AppError> { }
  list(query): Result<Page<Note>, AppError> { }
  update(id, changes, expectedRev): Result<Note, AppError> { }
  softDelete(id): Result<void, AppError> { }
}
```

Transactions wrap multi-repo operations. Optimistic concurrency uses `rev` fields (increment on update). Migrations are numbered TypeScript modules (F032), idempotent.

### API Routes

Grouped by domain:

- **`POST /notes`, `GET /notes/:id`, `PATCH /notes/:id`** — note CRUD
- **`GET /notes` (list)** — pagination, sort, filter by notebook/tag/date
- **`GET /search` (FQL)** — full-text search (FTS5) + vector search + hybrid ranking
- **`GET /notes/:id/backlinks`** — incoming wikilinks with context snippets
- **`POST /notes/:id/revisions/:rev/restore`** — restore old version
- **`POST /import`, `GET /export`** — bulk import/export (Markdown, Obsidian, Zip)
- **`POST /stories`, `GET /stories/:id`** — story CRUD
- **`POST /stories/:id/compile`** — compile .fable sources → bytecode
- **`POST /stories/:id/play`** — create playthrough, run story
- **`POST /stories/:id/playthroughs/:pid/choose`** — make a choice
- **`GET /entities`, `POST /entities`** — entity gallery + CRUD
- **`GET /world/mutations`** — entity mutation history (who wrote what, when)
- **`POST /world/snapshots`** — save world state; `GET /world/snapshots` + diff
- **`GET /graph`** — nodes + edges (notes, entities, stories) and filters
- **`GET /timeline`** — day-grouped feed of all events
- **`POST /sync/push`, `GET /sync/pull`** — op-log sync endpoints

All responses follow an envelope: `{ data }` on success, `{ error: { code, message } }` on error. Pagination uses cursor + limit. ETags on GETs.

### Compilation & Effects

When a story is compiled:

1. Lexer tokenizes all `.fable` files.
2. Parser builds an AST.
3. Resolution phase declares and resolves symbols (knots, stitches, variables, bindings).
4. Semantic checker validates types, entity bindings, structure.
5. Codegen produces bytecode (ops for text, choices, diverts, variables, effects).
6. Bytecode is stored and versioned.

At runtime, the **VM** executes bytecode. **Effects** are RPC calls from the VM to a host-provided handler. Built-in effects:

- `JOURNAL(...)` — append to daily note
- `ENTITY_SET(...)` — mutate entity field
- `ENCOUNTER(...)` — codex records "met this entity"
- Custom effects via plugin system (F1031)

### Logging & Observability

- **pino** logger with child loggers per subsystem (routes, repos, compiler).
- Request IDs propagated through all logs (F053).
- Slow query logging (threshold configurable).
- `/api/v1/debug/stats` endpoint: db size, note/story counts, memory, sync health.
- Rotating file logs in `DATA_DIR/logs/`.

### Authentication & Authorization

**No multi-user authentication yet.** Single-user design. Optional token gate (F886) for defense-in-depth: single bearer token checked on every request. Long-lived cookie for PWA sessions.

---

## Web App (apps/web)

**Vite + React 19** PWA. Single-page app. Renders the knowledge view (notes, graph, search), story authoring workspace, story player, and settings.

### State Management

- **React Query (TanStack Query):** caches API responses, handles background refetches, optimistic updates on mutations.
- **React Router:** page navigation (`/notes/:id`, `/stories/:id/author`, `/play/:storyId`).
- **IndexedDB (Dexie):** local offline cache for notes, entities, story metadata. UI reads from IDB first.
- **localStorage:** user preferences (theme, editor settings), offline draft recovery, annotation registry.

### Offline-First Sync

The web app is offline-by-default:

1. **On load:** service worker installs app shell (HTML, CSS, JS).
2. **On start:** app hydrates from IndexedDB (instant load).
3. **In background:** sync engine pulls ops from `/sync/pull` since last cursor.
4. **On edit:** mutations land in outbox table (pending writes).
5. **On reconnect:** sync pushes outbox to `/sync/push`; server applies ops; client pulls results back.
6. **On conflict:** UI shows conflict-review panel; user picks a resolution path.

**Op schema (packages/sync):**

```typescript
interface Op<T> {
  type: 'note' | 'entity' | 'save';
  kind: 'create' | 'update' | 'delete';
  id: string;
  deviceId: string;
  clock: number;           // Lamport clock
  timestamp: number;       // ISO timestamp
  idempotencyKey: string;  // UUID, prevents re-apply
  data: T;                 // the mutation
}
```

**Conflict resolution:**

- **Field-level LWW:** later `clock` + tiebreak by `deviceId`.
- **Note body:** three-way merge if both sides changed, otherwise newer wins.
- **Unresolvable:** create conflict-copy note; user merges manually.

### Key Routes & Components

- **`/notes`** — note list with sort/filter, notebook tree sidebar, note detail with markdown editor.
- **`/graph`** — force-directed graph view of all notes and links.
- **`/search`** — global search overlay with FTS + vector results.
- **`/stories`** — library grid view with progress badges.
- **`/stories/:id/author`** — three-pane workspace: file tree, editor, playtest pane or scene graph.
- **`/stories/:id/play`** — distraction-free player with choices, story state, lore pane, codex, bookmarks.
- **`/timeline`** — day-grouped feed of notes, stories, playthroughs.
- **`/world`** — entity mutation dashboard, snapshots, sandbox mode.
- **`/settings`** — theme, editor prefs, PWA install, sync health, debug tools.

### Design System (packages/ui)

CSS custom-property tokens for colors, spacing, type scale. Dark/light themes with system-preference detection. Primitives: Button, Input, Dialog, Popover, Tooltip, Toast. Lucide icons. Accessible focus-visible styles, reduced-motion support.

---

## The Forge Language & VM

### Lexer (packages/forge-dsl)

Line-oriented tokenizer. Switches between text mode (prose) and logic mode (identifiers, operators). Produces tokens with source spans (line, column, offset).

### Parser

Recursive descent into a typed AST. Error recovery at line boundaries so one bad line doesn't cascade. Parses:
- Knots (`===`) and stitches (`=`)
- Choices (`*` once-only, `+` sticky) with nesting depth
- Diverts `->` and tunnels (call/return)
- Variables, expressions, operators
- Knowledge bindings `@entity(...)` and `[[note]]` refs
- Inline conditionals `{ condition: a | b }`

### Symbol Resolution

Two-pass:
1. Declare all knots, stitches, variables, labels.
2. Resolve all references. Cross-file targets supported via INCLUDE graph.

Post-passes: unused variable warnings, unreachable knot detection, dead-end analysis.

### Codegen → IR → Bytecode

**IR (intermediate representation):** flat container tree with instructions for text output, choices, diverts, variable load/store.

**Bytecode:** ~40 opcodes (stack-based VM), string pool, instruction stream, source-map section, knowledge-binding table. Deserializes with version check.

### VM (packages/forge-vm)

Executes bytecode:

```typescript
const story = createStory(bytecode, knowledgeHost);

// Run until choice or end
const output = await story.continue();

// Get available choices
const choices = story.choices();

// Make choice and resume
const nextOutput = await story.choose(0);
```

State includes: globals map, visit counts, call stack, PRNG seed, turn counter, choice history. Serializable to JSON (for saves).

**External state:** host can inject read-only values (e.g., entity field snapshots) or live queries (`@hero.health` evaluated each turn).

**Effects:** RPC from VM to host. Built-in: `JOURNAL`, `ENTITY_SET`, `ENCOUNTER`. Host validates allowlist (F485) before executing.

---

## Data Flow Diagram

```
                    ┌─────────────────────────┐
                    │    User's Machine       │
                    │                         │
        ┌───────────┼─────────────────────┬───┼────────────┐
        │           │                     │   │            │
    ┌─────────┐  ┌──────────────┐    ┌────────────┐    ┌────────┐
    │ Browser │  │ Tailscale    │    │ Server     │    │ SQLite │
    │ (PWA)   │  │ (HTTPS over  │    │ (Fastify)  │    │ (data) │
    │         │  │  tailnet)    │    │            │    │        │
    └────┬────┘  └──────┬───────┘    └──────┬─────┘    └────┬───┘
         │               │                    │              │
         └───────────────┼────────────────────┴──────────────┘
                         │
                    REST API calls
                    (JSON envelope)

    React PWA               Offline Sync Engine       Server
    ─────────────────       ──────────────────       ──────
    
    IndexedDB              Op-Log
    (cached)        
         │                      │
         ├──────────────────────┼──────────────────────┐
         │                      │                      │
    IDB outbox            Op stream with       SQL mutations
    (pending ops)         Lamport clocks       (LWW resolution)
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                         /sync/push, /sync/pull
```

**Flow:**

1. User edits a note in the web app.
2. Mutation lands in IndexedDB outbox.
3. Sync engine batches ops and POSTs to `/sync/push`.
4. Server applies ops in Lamport order (conflict resolution).
5. Server stores ops in op-log table.
6. Client next pulls from `/sync/pull` to get server's ops.
7. Client applies server ops to IDB (merge if conflict).
8. UI re-renders from IDB state.

**Full read path:**

1. User opens a note.
2. React component reads from IDB (instant).
3. Component mounts a query subscription to fetch from `/notes/:id`.
4. Server returns latest; React Query updates cache.
5. Component re-renders if newer data available.

---

## Deployment

### Development

```bash
pnpm install
pnpm dev
```

Starts both server (localhost:4870 by default) and web app in watch mode. Vite dev proxy routes `/api/*` to the server.

### Production

```bash
pnpm build
pnpm start
```

Builds:
- `dist/server/`: compiled server code
- `dist/web/`: built React app (static)

Server serves both API and static files.

### Tailscale PWA

On your machine:

```bash
pnpm dev
tailscale serve --bg 4870
```

Tailscale exposes `https://mymachine.mytailnet.ts.net` with a valid cert. On iPhone:

1. Open Safari → paste URL
2. Share → Add to Home Screen
3. App installs as PWA

Service worker caches the app shell; offline editing works. When back online, sync happens automatically.

---

## Key Design Decisions

1. **SQLite, not PostgreSQL.** Single-user, local-first. File-based, backupable, no server ops needed.

2. **Op-log over CRDT.** Every mutation is an immutable operation. Lamport clock + device ID breaks ties deterministically. Simpler than CRDTs, easier to debug.

3. **IDB as the source of truth on the client.** Server is the canonical copy; client reads from fast IDB first, reconciles in background.

4. **Tailnet as perimeter.** No public internet exposure by default. Tailscale provides HTTPS + authentication (if enabled).

5. **Forge as a pure compiler.** No I/O inside the compiler; file access and knowledge lookups are injected. Allows offline compilation + graceful degradation.

6. **VM as an event-driven interpreter.** Story execution is a sequence of `continue()` calls (run until choice/end) and `choose(index)` (resume from choice). Saves can checkpoint any point.

7. **Effects as RPC.** Host controls what stories can do. Allowlist prevents arbitrary access.

8. **Markdown everywhere.** Notes are plain text with standard Markdown syntax. No proprietary format. Exportable.

---

## Testing Strategy

- **Unit tests:** per-package, Vitest with ~85% coverage target. Property tests for sync convergence.
- **Integration tests:** repos + routes tested against real SQLite + in-memory fixtures.
- **E2E tests:** Playwright drives browser, server, and checks full user journeys (note → link → graph, story → mutation → journal).
- **Fuzzing:** grammar-aware random Forge program generator to find parser crashes; random concurrent ops to verify sync convergence.

---

## Versioning & Compatibility

- **Bytecode versioning:** compile-time version in header; runtime negotiates. Incompatible bytecode = error with suggestion to recompile.
- **IDB migrations:** Dexie `version().stores()` pattern. Each app update can include a migration. If client IDB is newer than server, client blocks with a warning.
- **Diagnostic codes:** stable codes (FORGE001, FORGE002, …) never renumbered. New diagnostics append.

---

## Security & Privacy Model

- **Stored locally:** all data lives in `~/.fables` on your machine. No cloud sync by default.
- **Tailnet perimeter:** phone access only over your Tailscale VPN. No public internet.
- **Optional token auth:** single bearer token gate for defense-in-depth. Long-lived PWA cookie.
- **No exfiltration:** server has no network calls. Embeddings computed locally. Whisper transcription local.
- **Markdown/HTML sanitized:** wikilinks, attachments, story text all pass through sanitizers to prevent XSS.
- **SQL parameterized:** all queries use bound parameters; grep + tests verify.
- **Attachment serving:** path traversal checks, content-type sniffing guards.
- **Story VM sandbox:** effects allowlist prevents arbitrary host access.

See `docs/security.md` for the complete threat model.

---

## Future Architecture Changes

- **Multi-user support (F1001+):** user accounts, per-notebook sharing, access control.
- **Plugin system (F1001+):** worker-thread sandboxed plugins with RPC bridge, capability-based security.
- **Encryption (F1001+):** optional end-to-end encryption for sensitive data.
- **P2P sync (F1001+):** direct device-to-device sync over local network without server hop.
