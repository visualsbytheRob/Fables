# Fables

**A personal Knowledge OS fused with an interactive fiction engine.**
Your notes are the world. Your stories run on a compiler you own.

Fables combines a local-first note-taking system (wikilinks, graph view, daily notes, full-text +
semantic search) with **Fable Forge** — a custom storytelling language, compiler, and bytecode VM
for branching interactive fiction. Stories can read and mutate your knowledge base: characters are
notes, choices write journal entries, and lore is one tap away while you read.

Built remotely with Claude Code. Runs locally on your machine. Read it on your phone as a PWA over
[Tailscale](https://tailscale.com).

> 🚧 Under heavy construction: 1,000 features in 10 days. Progress lives in
> [FEATURES.md](./FEATURES.md) and the daily devlog in `docs/devlog/`.

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
