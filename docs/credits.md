# Credits & inspirations

Fables is built from scratch in TypeScript, but good ideas deserve acknowledgement.
This file records external work we've drawn _inspiration_ from (not code — Fables
takes no third-party code into its core), with the license noted.

## MemPalace — scoped retrieval & memory-quality benchmarking

- Project: [MemPalace](https://github.com/MemPalace/mempalace) (MIT)
- What we admired: its **"memory palace" structure** (people/projects → wings,
  topics → rooms, content → drawers) that scopes semantic search to a _namespace_
  instead of a flat corpus, and its discipline of measuring retrieval quality
  against a benchmark (LongMemEval).
- How it informs Fables (ideas only, reimplemented in TS):
  - **Scoped RAG** — retrieval already supports scoping by notebook; the
    namespace idea encourages extending that to tags/entities so "ask your vault"
    searches _within the relevant area_ (Epic 14 polish).
  - **Retrieval eval sets** — a concrete model for the deferred F1329 / F1369 RAG
    quality eval sets: measure whether grounded answers actually retrieve the
    right sources.
  - **The memory-palace metaphor** — a north star for the spatial views (Epic 16)
    and the spaced-repetition / learning epic (Epic 18): structured, navigable,
    _human_ memory.

MemPalace targets **AI/agent** memory (an LLM recalling past conversations);
Fables' learning epic targets **human** memory (helping _you_ remember). Different
goals, kindred spirit.

## From the maker's starred repos

A few projects [Rob](https://github.com/visualsbytheRob) has starred map beautifully
onto Fables' upcoming epics. We take **ideas and north stars** here, not code —
ideas aren't copyrightable, and anything concrete we borrow later we'll re-implement
in TypeScript after checking each repo's license.

- **[socrates](https://github.com/GregLMcDonald/socrates)** — a local AI tutor that
  turns documents into Socratic study sessions and exams. → **Epic 18 (Spaced
  Repetition & Learning):** go beyond flashcards — let the AI quiz you Socratically
  on your own notes to test real understanding, not just recall.
- **[remotion](https://github.com/remotion-dev/remotion)** — make videos
  programmatically with React. Same stack as our web app. → **Epic 19 (Story
  Interop & Distribution):** render a played-through fable into a shareable video
  (narration + choices + scenes), straight from the React renderer we already have.
- **TouchDesigner orbit** —
  [nodeo](https://github.com/theexperiential/nodeo),
  [Artio](https://github.com/theexperiential/Artio),
  [touchdesigner-mcp](https://github.com/8beeeaaat/touchdesigner-mcp) — node-based
  visual/media systems (one with an MCP server). → **Epic 16 (Canvas & Spatial
  Views)** and the **New Millennium Polish** WebGL work: node-graph spatial
  thinking, and a precedent for driving visuals through our plugin/AI surface.
- **Audio toolkits** —
  [CDP8](https://github.com/ComposersDesktop/CDP8) (Composers Desktop Project) and
  [ear-training-agent](https://github.com/maahhi/ear-training-agent). → **Epic 17
  (Audio Fables):** serious spectral/transformation techniques for soundscapes and
  narration, and audio-based learning drills that tie Epic 17 to Epic 18.
- **[beginner-local-rag-system](https://github.com/jamwithai/beginner-local-rag-system)**
  — confirms our local-first RAG direction (Epic 14), and is a friendly reference
  for documenting how "ask your vault" works.
- **[get-shit-done](https://github.com/gsd-build/get-shit-done)** — spec-driven,
  meta-prompted development. A kindred spirit to how Fables itself is built: one
  unflinching spec (`FEATURES.md`), green-gated commits, agents in lanes.
