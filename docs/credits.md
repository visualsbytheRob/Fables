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
