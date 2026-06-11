# Contributing to Fables

## Layout

pnpm monorepo: `apps/server` (Fastify + SQLite API), `apps/web` (React PWA),
`packages/core` (domain types/utils), `packages/forge-dsl` (story language compiler),
`packages/forge-vm` (story runtime), `packages/sync` (offline sync), `packages/ui` (design system).

## Commands

| Command              | What                                  |
| -------------------- | ------------------------------------- |
| `pnpm dev`           | server (:4870) + web (:5173) in watch |
| `pnpm test`          | all test suites (vitest)              |
| `pnpm test:coverage` | tests with coverage report            |
| `pnpm typecheck`     | strict tsc across the workspace       |
| `pnpm lint`          | eslint                                |
| `pnpm build`         | production build                      |
| `pnpm doctor`        | environment checks                    |

## Conventions

- The build follows [FEATURES.md](./FEATURES.md): features in order, one group = one commit
  (`feat(day-N): FXXX–FYYY <group>`), boxes checked in the same commit.
- TypeScript strict; no `any` unless a third-party boundary forces it.
- Errors: throw `AppError` from `@fables/core` — the server maps codes to HTTP automatically.
- All SQL lives in repos (`apps/server/src/db/repos/`); routes never touch the db directly.
- Keep `pnpm test`, `pnpm typecheck`, and `pnpm lint` green at every commit.
