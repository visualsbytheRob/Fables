# Fables — v1.0

**A personal Knowledge OS fused with an interactive fiction engine.**
Your notes are the world. Your stories run on a compiler you own.

## What Is This?

Fables combines a **local-first note-taking system** with **Fable Forge**, a custom language and bytecode VM for
interactive storytelling. Write notes with wikilinks, explore them as a graph, tag them, search them, and read them
every day. Then write interactive stories in the Forge language—a syntax designed to feel like prose but compile to
bytecode. Stories can read your notes as lore, branch on knowledge state, and write back: characters are entities,
choices create journal entries, and your knowledge base is the world the story inhabits.

Built remotely with Claude Code over 10 days (1,000 features, 1,868 tests green). Runs locally on your machine.
Read it on your iPhone as a PWA over [Tailscale](https://tailscale.com). All data stays in `~/.fables`. No cloud.
No fees. No tracking.

## v1.0 Features

- **Knowledge OS:** notes with Markdown, wikilinks, backlinks, graph visualization, full-text search, daily journal,
  tags, notebooks, saved queries, templates
- **Forge DSL & VM:** a prose-first storytelling language with knots, choices, variables, conditionals, diverts.
  Stack-based bytecode VM with saves and playback
- **The Fusion:** stories read notes via `@entity.field` bindings and `[[lore]]` references. Conditions branch on
  knowledge state. Effects write journal entries and mutate entity fields
- **Offline-First PWA:** install on iPhone via Safari Add-to-Home-Screen. Full offline editing with IndexedDB cache.
  Automatic sync when reconnected (op-log with Lamport clocks, conflict resolution)
- **Security & Privacy:** all data lives on your machine. Optional token auth. Tailnet-only access (no public
  internet). Comprehensive security audit: SQL injection, XSS, path traversal, story VM sandbox
- **Accessibility:** full keyboard navigation, screen reader support, color contrast (AA standard), reduced-motion
  respected
- **Backup & Restore:** scheduled nightly backups with retention policy. One-file restore. Disaster recovery docs
- **Local Analytics:** usage metrics stay in SQLite. Zero network egress. Users can inspect and purge
- **Structured Development:** built with parallel agent teams (orchestrator, code lanes, docs lane). 1,868 tests green.
  FEATURES.md tracks all 1,000 features

## Built with the Parallel-Agent Architecture

This project was executed using Claude Code and a team of specialized agents working on disjoint packages in parallel.
Each agent owns a lane (Forge DSL, server, web, docs) and commits on green. See
[docs/devlog/tier-1-retrospective.md](./docs/devlog/tier-1-retrospective.md) for the full story.

## Getting Started

Start with [docs/guide/getting-started.md](./docs/guide/getting-started.md) for a walkthrough of notes, linking, and daily journaling. Then try [docs/forge/tutorial.md](./docs/forge/tutorial.md) to write your first interactive story.

For architecture details, see [docs/architecture.md](./docs/architecture.md). For Tailscale PWA setup on iPhone, see [docs/tailscale.md](./docs/tailscale.md).

## Quickstart

```bash
# prerequisites: Node 22+ (see .nvmrc), pnpm 10+
git clone https://github.com/visualsbytheRob/Fables.git
cd Fables
pnpm install
pnpm doctor       # verifies your environment
pnpm dev          # starts the server + web app
```

## Phone access via Tailscale

```bash
tailscale serve --bg <server-port>
```

Then open the printed `https://<machine>.<tailnet>.ts.net` URL on your iPhone and **Share → Add to
Home Screen** to install the PWA. Full guide (with HTTPS notes and troubleshooting) will live in
`docs/tailscale.md`.

## Monorepo layout

| Path                 | What it is                                          |
| -------------------- | --------------------------------------------------- |
| `apps/server`        | Fastify + SQLite API server, serves the built web app |
| `apps/web`           | React PWA (Vite)                                    |
| `packages/core`      | Domain types, schemas, shared utilities             |
| `packages/forge-dsl` | The Fable language: lexer, parser, compiler          |
| `packages/forge-vm`  | Bytecode VM that plays compiled stories             |
| `packages/sync`      | Offline-first op-log sync engine                    |
| `packages/ui`        | Design system primitives                            |

## Commands

```bash
pnpm dev          # run everything in watch mode
pnpm build        # production build
pnpm test         # run all test suites
pnpm lint         # eslint
pnpm typecheck    # tsc across the workspace
pnpm format       # prettier
```

## Configuration

Precedence: **CLI flags > environment > `fables.config.json` > defaults**.

| Setting   | Flag          | Env         | Default      |
| --------- | ------------- | ----------- | ------------ |
| Port      | `--port`      | `PORT`      | `4870`       |
| Host      | `--host`      | `HOST`      | `127.0.0.1`  |
| Data dir  | `--data-dir`  | `DATA_DIR`  | `~/.fables`  |
| Log level | `--log-level` | `LOG_LEVEL` | `info`       |

`--open` opens a browser after start. See `.env.example`; effective config is served at
`GET /api/v1/config`. No secrets ever live in this repo.
