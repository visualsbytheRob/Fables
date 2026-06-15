# Fables

**A personal Knowledge OS fused with an interactive-fiction engine.**
Your notes are the world. Your stories run on a compiler you own. Everything local, everything yours.

> Built in the open, one fable at a time — a **2,026-feature** journey from a blank repo to a
> complete personal-software suite. **The plan is complete**: every feature shipped, or honestly
> deferred (`[~]`) with a reason. **~4,100 tests green**, and not a byte of your data leaves your machine.
>
> 👉 **Never installed something like this before?** Jump to
> [**Install Fables — the gentle, step-by-step guide**](#install-fables--the-gentle-step-by-step-guide).

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

### ✅ Tier 2 — the power tier (F1001–F2000)

| Epic                                           | Theme                                                                                  | Status       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- | ------------ |
| **11 — Plugins & Extensions**                  | A sandboxed plugin runtime + capability system + SDK                                   | ✅ Complete  |
| **12 — Real-Time Collaboration**               | CRDT core (Yjs), live editing, sharing model, merge history                            | ✅ Complete  |
| **13 — Encrypted Vault & Security**            | Argon2id + XChaCha20 vault, secret notes, audit log, compliance, SSRF guard            | ✅ Complete¹ |
| **14 — AI Co-Writer & Modality Mesh**          | Local-first AI: RAG, note intelligence, co-writer, streaming, llama.cpp, opt-in Claude | ✅ Complete  |
| **15 — Importers & Interop**                   | 19 importers, 6 export formats, format-detection, round-trip fidelity                  | ✅ Complete  |
| **16 — Canvas & Spatial Views**                | Infinite canvas, world atlas, spatial thinking                                         | ✅ Complete  |
| **17 — Audio Fables**                          | Narration, soundscapes, the `audio` modality                                           | ✅ Complete  |
| **18 — Spaced Repetition & Learning**          | FSRS-5 scheduler, cards/decks, Anki interop, learning insights                         | ✅ Complete  |
| **19 — Story Interop & Distribution**          | `.fablepack`/`.fablearchive`, Ink/Twee import, generative art                          | ✅ Complete  |
| **20 — Multi-Vault, Automation & Power Tools** | Vault registry, automation, webhooks, scripting, bulk ops, FQL v2, power tools         | ✅ Complete  |

¹ The vault's cryptography, secret-notes key path, audit log, and security tier are shipped and tested.
A few deep-integration and multi-device-transport pieces remain `[~]` (deferred-with-reason) — the
honest edges, listed in [`FEATURES.md`](./FEATURES.md).

### 🎨 Encore — New Millennium Polish (F2001–F2022)

22 design-led features to make it _gorgeous_ — OKLCH perceptual color, editorial typography on a
baseline grid, GSAP-class spring motion + view transitions, WebGL/GLSL showpieces (ambient gradient
mesh, glass materials, a GPU-rendered knowledge graph), all reduced-motion- and battery-aware. Apple
restraint, Pentagram craft. The computational design-system core (color/type/motion) is shipped and
tested; the GPU/CSS rendering surfaces are the web app's to paint. The 22 that round the plan up to 2,026.

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

## Install Fables — the gentle, step-by-step guide

> **New to this kind of thing? This section is for you.** It assumes **zero** prior
> experience. Take it slowly; you can't break anything.

### Read this once: honest expectations

- **It's free software you run on _your own_ computer.** There's no App Store, no
  website to sign up for, no subscription, and nothing of yours ever leaves your
  machine.
- **It's not a double-click `.exe` (yet).** You'll copy-and-paste a few commands
  into a plain text window called a **Terminal**. That's the only unfamiliar part —
  everything is copy-paste, and we explain each line. Budget about **20–30 minutes**
  the first time. After that, starting Fables is **one command**.
- **Where it lives:** put it in **any** folder you like — your home folder or
  Documents is perfect, and it doesn't need to be anywhere special. **One nuance:**
  if you plan to keep tinkering with Fables itself using **Claude Code** (e.g.
  cowork / dispatch), put the folder somewhere Claude Code is allowed to work —
  many people keep a dedicated projects/Claude folder for exactly this. Either
  way, your **notes** live separately in `~/.fables`, so moving the code folder
  later never touches your data.
- **Two devices, two jobs:** your **laptop runs Fables** (it's the engine, always
  the "real" copy). Your **iPhone simply opens it** in Safari over your private
  network — you don't copy any code onto the phone.
- **What do you connect it to? Nothing — but you _can_.** Fables works completely
  on its own (offline, private, no accounts or keys). When you want more, it plugs
  into **local or cloud AI** (Ollama, llama.cpp, or the Claude API), **generated
  art** (a local or cloud ComfyUI diffusion server), and **voices** (Piper) — see
  [Step 7](#step-7-optional--add-power-ups-ai-art-and-voices). **None are required**,
  and any cloud option stays off until you explicitly opt in.

### Which computer are you on?

- **Mac** — the smoothest path. Follow the steps as written.
- **Linux** — also smooth. Follow the steps as written.
- **Windows** — Fables runs best inside **WSL** (Windows Subsystem for Linux), a
  free, official Microsoft feature that gives you a tidy Linux environment where
  these tools "just work." One-time setup: open **PowerShell as Administrator**, run
  `wsl --install`, restart, and pick a username/password when prompted. Then open
  the new **Ubuntu** app from your Start menu and follow the steps below inside it.

---

### Step 1 — Install the two free tools Fables is built on

Fables runs on **Node.js** (the engine) and uses **pnpm** (which fetches its
building blocks). You install these once.

1. **Node.js (version 22 or newer).** Go to **[nodejs.org](https://nodejs.org)** and
   download the **LTS** installer for your system, then run it and click through.
   (On Mac with [Homebrew](https://brew.sh): `brew install node`. On WSL/Ubuntu:
   `sudo apt update && sudo apt install -y nodejs npm`.)

2. **pnpm.** Open your Terminal (on Mac: **Terminal** app; on Windows: the **Ubuntu**
   app; on Linux: your terminal) and run:

   ```bash
   npm install -g pnpm
   ```

To check both worked, run `node --version` (should say `v22` or higher) and
`pnpm --version` (should say `10` or higher).

### Step 2 — Download Fables

**Option A — the simple way (no extra tools):** on the
[GitHub page](https://github.com/visualsbytheRob/Fables), click the green **Code**
button → **Download ZIP**, then unzip it wherever you like.

**Option B — the better way for getting updates later** (needs [git](https://git-scm.com)):

```bash
git clone https://github.com/visualsbytheRob/Fables.git
```

Either way, you now have a folder called **`Fables`**. In your Terminal, move into
it (type `cd ` then drag the folder onto the Terminal window to fill in the path,
then press Enter):

```bash
cd Fables
```

### Step 3 — Build it and start it

Run these three commands one at a time (the first two take a few minutes the first
time — that's normal):

```bash
pnpm install      # fetches Fables' building blocks
pnpm build        # assembles the app
pnpm start        # starts Fables
```

When it's running you'll see log lines and it will **keep running** — that's good.
**Leave this Terminal window open**; closing it stops Fables. (To stop it on
purpose, click the window and press **Ctrl + C**.)

> Want a few example notes and a sample story to explore? In a **second** Terminal
> window (same `Fables` folder), run `pnpm seed:demo` once before starting.

### Step 4 — Open it on your laptop

Open a web browser and go to:

```
http://localhost:4870
```

That's Fables. Have a click around — make a note, try a `[[wikilink]]`. Everything
you do is saved on your own machine (in a hidden folder called `.fables` in your
home directory).

### Step 5 — Reach it on your iPhone (over Tailscale)

[Tailscale](https://tailscale.com) is a **free**, private network that securely
connects _your_ devices to each other — and **only** yours. It's how your phone
talks to your laptop without exposing anything to the public internet, and it
provides the secure `https://` address an installable phone app needs.

1. **Make a free Tailscale account** at [tailscale.com](https://tailscale.com).
2. **Install Tailscale on your laptop** and sign in
   ([Mac](https://tailscale.com/download/mac) · [Windows](https://tailscale.com/download/windows)
   · [Linux](https://tailscale.com/download/linux)). On Mac/Linux you can also run
   `sudo tailscale up`.
3. **Install the Tailscale app on your iPhone** (App Store) and sign in with the
   **same account**.
4. With Fables still running (Step 3), tell Tailscale to share it. In a Terminal on
   your laptop:

   ```bash
   tailscale serve --bg 4870
   ```

   Tailscale prints a secure address like
   `https://your-laptop.your-tailnet.ts.net`.

5. On your **iPhone**, open **Safari** and go to that exact `https://…ts.net`
   address. Fables loads. 🎉

(There's a deeper walkthrough, including troubleshooting, in
[docs/tailscale.md](./docs/tailscale.md).)

### Step 6 — Install it like an app (Home Screen, dock, Start menu)

Fables is a **PWA** (Progressive Web App) — modern browsers can "install" a website
so it gets its own icon and opens in its own window, just like a normal app. No
App Store needed.

- **On your iPhone (Safari):** with Fables open, tap the **Share** button (the
  square with an up-arrow) → **Add to Home Screen** → **Add**. You now have a Fables
  icon on your home screen that opens full-screen.
- **On your laptop (Chrome or Edge):** open `http://localhost:4870`, then click the
  **Install** icon at the right of the address bar (a little screen-with-arrow) →
  **Install**. You'll get a Fables icon you can pin to your **dock / taskbar / Start
  menu** and launch like any app. (Safari on Mac: **File → Add to Dock**.)

### Step 7 (optional) — Add power-ups: AI, art, and voices

**You don't need any of these to use Fables.** Everything except these specific
extras already works out of the box. But Fables is built to _grow_ — it has a
pluggable "modality mesh" where you can light up **AI writing help**, **generated
art**, and **spoken narration** whenever you want. You choose **local** (runs on
your own machine, fully private) or **cloud** (a hosted service, faster/stronger
but data leaves your machine — so it's always **opt-in and consent-gated**).

> **How to give Fables a setting:** these are turned on with **environment
> variables** at start time. The easy way is to put them in front of the start
> command, e.g.
> `ANTHROPIC_API_KEY="sk-ant-…" FABLES_COMFY_URL="http://127.0.0.1:8188" pnpm start`.
> You can combine as many as you like on one line.

#### 🤖 AI writing help (RAG "ask your vault", summaries, tags, the story/character co-writer)

Pick **either** a local model **or** Claude (or both — Fables prefers whichever is
available, and you can route per-feature):

| Option                      | Private?          | How to set it up                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ollama** (local, easiest) | ✅ 100% on-device | Install [Ollama](https://ollama.com), run `ollama pull llama3.1` (or any model). Fables **auto-detects** it on the default port. Override with `FABLES_OLLAMA_URL`.                                                                                                                                                                                                                                                 |
| **llama.cpp** (local)       | ✅ 100% on-device | Run `llama-server`. Set `FABLES_LLAMACPP_URL` if it's not on `http://127.0.0.1:8080`.                                                                                                                                                                                                                                                                                                                               |
| **Claude API** (cloud)      | ⚠️ Opt-in         | Get a key at [console.anthropic.com](https://console.anthropic.com), set `ANTHROPIC_API_KEY="sk-ant-…"`. **Two locks:** the key enables the adapter, **and** you must turn cloud AI on + accept the egress-consent prompt inside Fables (Settings → AI). Nothing is sent until you do. A global **kill switch** turns all AI off instantly, and secret/encrypted notes are filtered out before any prompt is built. |

#### 🎨 Generated art (cover & scene illustrations for your stories, via Stable Diffusion / Flux, etc.)

Fables talks to **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)** — the
popular node-based diffusion engine — over its HTTP API. Same local-or-cloud
choice, pointed at with one variable, **`FABLES_COMFY_URL`**:

| Option                                    | Private?          | How to set it up                                                                                                                                                                                                        |
| ----------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ComfyUI Desktop / local** (recommended) | ✅ 100% on-device | Install [ComfyUI Desktop](https://www.comfy.org/download) (or run ComfyUI yourself), load a diffusion model (SDXL, Flux, …), and set `FABLES_COMFY_URL="http://127.0.0.1:8188"`. No consent needed — it's your machine. |
| **ComfyUI in the cloud** (hosted)         | ⚠️ Opt-in         | Point `FABLES_COMFY_URL` at your hosted ComfyUI endpoint. Because images would leave your machine, the cloud path stays **off until you grant egress consent** in Fables — exactly like the Claude path.                |

If ComfyUI isn't configured, Fables falls back to a clean, typographic SVG cover
automatically — stories still get art, just generated locally without a model.

#### 🔊 Spoken narration (read notes and stories aloud)

| Option            | Private?          | How to set it up                                                                                                         |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Piper** (local) | ✅ 100% on-device | Install [Piper](https://github.com/rhasspy/piper) and download a voice model; Fables uses it for narration & audiobooks. |

**The golden rule:** if an optional tool isn't present, the matching feature
simply stays quiet — Fables never breaks because a power-up is missing, and
**nothing ever leaves your machine unless you explicitly turn on a cloud option
and accept its consent prompt.**

### Keeping it running, and starting it again tomorrow

- **To stop Fables:** click its Terminal window and press **Ctrl + C**.
- **To start it again later:** open a Terminal, `cd` into the `Fables` folder, and
  run `pnpm start`. (You only `pnpm install` / `pnpm build` again after you
  **update** to a new version.)
- **To update to the latest version:** if you used `git clone`, run `git pull` then
  `pnpm install && pnpm build`. If you downloaded the ZIP, download a fresh ZIP and
  rebuild. Your notes (in `~/.fables`) are untouched by updates.
- **Want Fables to start automatically when your laptop boots?** That's a more
  advanced setup (a background service); ask and we can add it.

### If something goes wrong

- **`command not found` for `pnpm` or `node`** — Step 1 didn't finish; reinstall
  Node.js, close and reopen the Terminal, and try again.
- **"port already in use"** — something else is on port 4870. Start on another port:
  `PORT=4871 pnpm start` (and then `tailscale serve --bg 4871`).
- **The phone can't reach it** — make sure (a) Fables is still running on the
  laptop, (b) `tailscale serve` is running, and (c) both devices are signed into the
  **same** Tailscale account. Run `pnpm doctor` on the laptop for a quick health
  check.
- **Still stuck?** Open an issue on GitHub, or see
  [docs/troubleshooting.md](./docs/troubleshooting.md).

---

## Getting started (for developers)

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
