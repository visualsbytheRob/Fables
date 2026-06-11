# Day 1 — Foundation & Monorepo (F001–F100) ✅

**Shipped:** all 100 features. The skeleton of Fables is real and verified.

## What exists now

- **Monorepo:** pnpm workspace, strict shared TypeScript, eslint flat config, prettier,
  doctor script, pre-commit hooks, CI workflow with coverage + bundle-size budget.
- **`@fables/core`:** branded monotonic-ULID ids, full domain model (notes + stories sides),
  zod schemas, Result type, AppError taxonomy with stable codes, date/slug utilities.
- **`@fables/server`:** Fastify factory with layered config (flags > env > file > defaults),
  SQLite with WAL + foreign keys, idempotent migrations, typed repos with optimistic
  concurrency, seed/backup/integrity CLI, rolling file logs, slow-query instrumentation,
  debug stats + runtime log level, ETag/compression/rate-limit, envelope + cursor pagination
  conventions, contract tests.
- **`@fables/ui`:** token system with dark/light themes, primitives (Button/Input/Dialog/etc.),
  toasts, fuzzy ⌘K command palette, focus-visible + reduced-motion support.
- **`@fables/web`:** Vite + React 19 shell with router, TanStack Query, typed API client,
  error boundary, responsive sidebar that collapses for phones, `/playground` QA route.

## Numbers

48 tests, 74.8% line coverage, web bundle ~well under budget, `pnpm build` green.

## Decisions made

- Server default port **4870**; data lives in `~/.fables`; single-user, tailnet-as-perimeter.
- Internal packages export TypeScript source directly (`exports` → `src/index.ts`);
  bundling/packaging concerns deferred to Day 10 (F991) intentionally.
- Migrations are TS modules (numbered, append-only) rather than .sql files so the production
  build needs no asset copying — convention preserved, mechanism simpler.
- SPA fallback explicitly excludes `/api/*` so API misses stay JSON 404s (caught by test).

## Deferred / notes for Day 2

- Nothing deferred. Day 2 starts at **F101** (note CRUD API) and builds on the repos +
  conventions from today: routes should use `parseWith`, `parsePagination`, and repos only.
- Workflow note: pushes go **directly to `main`** (user's standing instruction, 2026-06-11).
