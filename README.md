# Fables

**A personal Knowledge OS fused with an interactive-fiction engine.**
Your notes are the world. Your stories run on a compiler you own. Everything local, everything yours.

> Being built in the open, one fable at a time — a **2,026-feature** journey from a blank repo to a
> complete personal-software suite. **1,340 features shipped** so far, **~2,770 tests green**, and not a
> byte of your data leaves your machine.

---

## What is this?

Fables combines a **local-first note-taking system** with **Fable Forge** — a custom language and
bytecode VM for interactive storytelling. Write notes with `[[wikilinks]]`, explore them as a graph,
tag and search them, journal daily. Then write branching stories in the Forge language — prose-first
syntax that compiles to bytecode — where **your notes are the lore**: characters are entities, choices
read and write your knowledge base, and the world the story inhabits is the one you actually keep.

It runs on your own machine, reads beautifully on an iPhone as a PWA over
[Tailscale](https://tailscale.com), and stores everything in `~/.fables`. No cloud. No fees. No tracking.

## Why it's a little different

- **Local-first, genuinely.** SQLite on your disk. Optional token auth. Tailnet-only access. AI is
  optional and, when on, secret/encrypted content is filtered out before any model ever sees it.
- **You own the story engine.** Not a wrapper around someone else's format — a real lexer, parser,
  compiler, and stack-based VM you can read end to end.
- **Notes ⇄ stories, both directions.** Stories branch on knowledge state via `@entity.field`
  bindings and `[[lore]]` references; effects write journal entries and mutate entity fields.
- **Honest by construction.** Every feature is tracked in [`FEATURES.md`](./FEATURES.md). When
  something is only partly done, it's marked `[~]` with the reason — never quietly overclaimed.

---

## The journey so far

The plan is **two tiers and an encore — 2,026 features** (yes, like the year). Here's where we are:

### ✅ Tier 1 — the v1.0 foundation (F1–F1000)

The complete Knowledge OS + Fable Forge: Markdown notes, wikilinks, backlinks, graph view, full-text +
semantic search, daily journal, tags, notebooks, saved queries, templates; the Forge DSL & VM (knots,
choices, variables, conditionals, diverts, saves, playback); the fusion of the two; an offline-first
PWA with op-log sync; security hardening; accessibility; backups; local analytics. **Shipped.**

### 🚧 Tier 2 — the power tier (F1001–F2000)

| Epic                                           | Theme                                                                            | Status                |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | --------------------- |
| **11 — Plugins & Extensions**                  | A sandboxed plugin runtime + capability system + SDK                             | ✅ Complete           |
| **12 — Real-Time Collaboration**               | CRDT core (Yjs), live editing, sharing model, merge history                      | ✅ Complete           |
| **13 — Encrypted Vault & Security**            | Argon2id + XChaCha20 vault, audit log, compliance, SSRF guard                    | ✅ Core complete¹     |
| **14 — AI Co-Writer & Modality Mesh**          | Local-first AI: RAG, note intelligence, story/character co-writer, opt-in Claude | ✅ Complete           |
| **15 — Importers & Interop**                   | 19 importers, 6 export formats, format-detection, round-trip fidelity            | 🚧 ~80% (F1401–F1480) |
| **16 — Canvas & Spatial Views**                | Infinite canvas, world atlas, spatial thinking                                   | 🔭 Planned            |
| **17 — Audio Fables**                          | Narration, soundscapes, the `audio` modality                                     | 🔭 Planned            |
| **18 — Spaced Repetition & Learning**          | Turn your vault into durable memory                                              | 🔭 Planned            |
| **19 — Story Interop & Distribution**          | Publish & share playable fables                                                  | 🔭 Planned            |
| **20 — Multi-Vault, Automation & Power Tools** | Scale, scripting, the workshop                                                   | 🔭 Planned            |

¹ The vault's cryptography, audit log, and security tier are shipped and tested; threading at-rest
field encryption through every last note-service path (the "keystone") is deliberately parked for its
own focused session — a careless change there risks a plaintext leak, so it gets done carefully or not
at all.

### 🎨 Encore — New Millennium Polish (F2001–F2022)

22 design-led features to make it _gorgeous_ — OKLCH perceptual color, editorial typography on a
baseline grid, GSAP-class spring motion + view transitions, WebGL/GLSL showpieces (ambient gradient
mesh, glass materials, a GPU-rendered knowledge graph), all reduced-motion- and battery-aware. Apple
restraint, Pentagram craft. The 22 that round the plan up to 2,026.

### Recent marquee work

- **AI Co-Writer (Epic 14):** "ask your vault" RAG with cited, grounded answers and an honest "no good
  sources" refusal; note intelligence (summarize, tag, outline, rewrite); a story & character
  co-writer; an **opt-in** Claude cloud adapter behind an egress-consent gate; a global kill switch;
  and a hard wall that keeps encrypted content out of every prompt.
- **Importers & Interop (Epic 15):** import from **Notion, Apple Notes, Evernote, Roam, Logseq, Bear,
  Day One, Simplenote, Google Keep, Standard Notes, Joplin** and any folder of Markdown — with a
  dry-run report, provenance, resume, and one-click rollback on every import. Export to **JSON
  (lossless), Obsidian, Notion, Logseq, a static HTML site, and a print-ready PDF book**, scoped by an
  FQL query if you like, with a round-trip fidelity test guarding against silent loss.

---

## Built by a team of agents, in the open

Fables is written with **Claude Code** driving a small formation of specialized agents in parallel: an
**orchestrator** that owns the shared seams (registries, routes, the green-gate), two **code lanes**
working on disjoint directories so they never collide, and a **docs lane**. Each unit lands only when
`pnpm test`, `pnpm typecheck`, and `pnpm lint` are all green, then it's committed and pushed. The whole
story — decisions, dead ends, retrospectives — lives in [`docs/devlog/`](./docs/devlog/).

It's an experiment in long, autonomous, _honest_ building: the agents resolve their own problems and
keep going, but every claim is backed by a passing test and an unflinching `FEATURES.md`.

---

## Getting started

Start with [docs/architecture.md](./docs/architecture.md) for the big picture, then the import guides in
[`docs/`](./docs/) (Notion, Evernote, Apple Notes, outliners, …) and [docs/ai.md](./docs/ai.md) for how
the local-first AI works. For iPhone PWA setup, see [docs/tailscale.md](./docs/tailscale.md).

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
Home Screen** to install the PWA. Full guide in [docs/tailscale.md](./docs/tailscale.md).

## Monorepo layout

| Path                 | What it is                                            |
| -------------------- | ----------------------------------------------------- |
| `apps/server`        | Fastify + SQLite API server, serves the built web app |
| `apps/web`           | React PWA (Vite)                                      |
| `packages/core`      | Domain types, schemas, shared utilities               |
| `packages/forge-dsl` | The Fable language: lexer, parser, compiler           |
| `packages/forge-vm`  | Bytecode VM that plays compiled stories               |
| `packages/sync`      | Offline-first op-log sync engine                      |
| `packages/ui`        | Design-system primitives                              |

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

| Setting   | Flag          | Env         | Default     |
| --------- | ------------- | ----------- | ----------- |
| Port      | `--port`      | `PORT`      | `4870`      |
| Host      | `--host`      | `HOST`      | `127.0.0.1` |
| Data dir  | `--data-dir`  | `DATA_DIR`  | `~/.fables` |
| Log level | `--log-level` | `LOG_LEVEL` | `info`      |

`--open` opens a browser after start. Effective config is served at `GET /api/v1/config`. No secrets
ever live in this repo, and your notes never leave your machine.

---

_2,026 features. Two tiers and an encore. One fable at a time._
