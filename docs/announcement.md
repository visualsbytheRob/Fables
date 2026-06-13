# Fables v1.0 — A Ship Worthy of a Story

## The Shipwright's Tale (A Fable)

Once, a shipwright set out to build a vessel. Not a raft, not a barge — a proper ship that could sail both calm seas
and tempests. But the shipwright had a strange vision: the ship would be made of the crew's own stories.

The crew would first gather knowledge — charts, notes, memories, songs — and weave them together with threads called
links. They'd watch the threads form patterns on a map, islands of thought connected by stories.

Then came the second task: to teach the ship itself to sail. The shipwright gave the ship a language — simple enough
that even a poet could speak it, powerful enough that it understood branching rivers and hidden coves. The ship learned
to read the crew's knowledge: *if the crew remembers this island, then sail there*. The ship learned to write back: *I
visited here, mark it in your journal*.

The crew worked for ten days without rest. They tested every sail, every knot, every provision. They made sure the ship
would sail even when the radio was silent. They built it strong enough that no storm of corrupted data could sink it.

When the tenth dawn broke, the ship was complete. Not perfect — there were grander ships sketched in the distance, ships
that could sail with a whole crew steering together, ships that could explore mysteries yet unmapped. But this ship was
seaworthy. It could take one sailor far.

The shipwright walked the deck one last time, checking ropes and bearings. The ship waited, bobbing gently, ready.

**The moral:** a complete thing, honestly made, ready to sail, is worth more than a half-finished dream. Build it, test
it, set it free.

---

## What Ships Today: Fables v1.0

**Fables** is a personal Knowledge OS (notes, links, graph, search, daily journal) fused with **Fable Forge**, a custom
storytelling language and bytecode VM. Stories you write can read your notes as world-building, branch based on what
you know, and write back to your journal. Everything runs on your machine. Everything syncs offline-first. Your iPhone
is a reader.

**Built in 10 days** with Claude Code and parallel agent teams. **1,000 features shipped.** **1,868 tests green.** No
technical debt left behind. Complete, tested, and ready to sail.

### What You Get

- **A note-taking system** that feels like Obsidian but is yours alone, searchable, tagged, graphed, journaled.
- **A storytelling engine** where you write interactive fiction in a prose-first language. No code required (unless you
  want it). Your stories have branches, choices, variables, and they can read your notes to fetch lore.
- **Offline-first sync** that keeps your phone and your laptop in sync automatically, without you thinking about it.
  Offline editing. Conflict resolution when two devices disagree.
- **A tailnet app** that lives on your iPhone's home screen, works over Tailscale (your private VPN), needs no cloud
  account.
- **Security by design:** SQL injection audited, XSS sanitized, story VM sandboxed, optional token auth, all data local.
- **Accessibility:** keyboard navigation, screen reader support, color contrast, reduced-motion respected.
- **Backup and restore** with one command. Disaster recovery docs included.

### What Doesn't Ship Yet (Sketched for Tier 2)

- Multi-user collaboration (real-time shared editing with CRDT).
- Plugin architecture (extensible by users).
- AI/embedding layer (local semantic search, link suggestions).
- Browser-based E2E tests (deferred; manual testing + accessibility audits cover it for now).
- Generated API docs (route registry exists; generator is a follow-up).

These are *genuinely future work*, not rushed. Tier 1 is complete without them.

### Install & Go

```bash
git clone https://github.com/visualsbytheRob/Fables.git
cd Fables
pnpm install
pnpm doctor       # checks your setup
pnpm dev          # starts server + web
```

On your phone, follow [docs/tailscale.md](./docs/tailscale.md) to install the PWA.

Then read [docs/guide/getting-started.md](./docs/guide/getting-started.md) and [docs/forge/tutorial.md](./docs/forge/tutorial.md).

### The Numbers

- **1,000 features** tracked in [FEATURES.md](./FEATURES.md) and shipped across 10 days.
- **1,868 tests** green. 85%+ coverage per package. All tests pass in under 3 minutes.
- **7 packages:** core (domain), forge-dsl (compiler), forge-vm (bytecode), sync (offline), ui (design system), server
  (API), web (PWA).
- **10 days of build:** Days 1–3 (foundation, notes, linking), Days 4–5 (Forge DSL), Days 6–7 (Forge VM, fusion), Days
  8–9 (search, PWA, offline-first), Day 10 (hardening, security, backup, a11y, perf, ship).

### Architecture

The system is built as a pnpm monorepo: a Fastify + SQLite server, a Vite + React PWA, and five shared packages. Notes
and entities live in SQLite. The Forge compiler is pure (no I/O); file access and knowledge lookups are injected,
allowing offline compilation. Stories sync via an op-log with Lamport clocks (same machine-local technique as Git
rebase). The client hydrates from IndexedDB (instant). Conflicts resolved with last-write-wins + three-way merge on
note bodies. Effects (JOURNAL, ENTITY_SET, ENCOUNTER) are RPC calls from the VM to a host handler, preventing escape.

See [docs/architecture.md](./docs/architecture.md) for the full picture.

### Why Local-Only?

No cloud means no server ops, no account management, no API versioning, no uptime SLA, no third-party data. Your data
is yours. Backups are local. Privacy is the default, not a feature you turn on.

For phone access, Tailscale (your private VPN) provides HTTPS without exposing your machine to the public internet. No
account needed; if you have Tailscale installed (most devs do), you're already set up.

For future multi-user or cloud sync, the architecture supports it (ops include a user ID; server can validate
permissions). But Tier 1 ships single-user, tailnet-only.

### What's Next?

Tier 2 (F1001–F2000) stretches to: plugin architecture, real-time collaboration (CRDT), AI/embedding layer,
multi-user accounts, mobile apps, web clipper, and more.

But that's a different project. **Tier 1 is done. Ship it.**

---

## Acknowledgments

Built with Claude Code, an agent-driven development tool by Anthropic. The parallel-agent architecture — specialized
types working on disjoint packages in parallel — scaled this project from idea to ship in 10 days. Each agent owned a
lane (Forge DSL/VM, server, web, docs) and committed on green. No merge conflicts. No broken tree.

See [docs/devlog/tier-1-retrospective.md](./docs/devlog/tier-1-retrospective.md) for lessons learned.

The codebase is built entirely in TypeScript. Tests are Vitest. The language spec is inspired by Ink (Inklewriter's
Ink language) but designed from scratch around knowledge-base bindings and offline-first storytelling.

**Thank you to the system for holding complexity steady. To the tests for catching bugs early. To the parallel agents
for shipping daily. To the user for the standing instruction to "push to main" — it meant we committed early and often,
and recovery from loss was easy.**

---

**Fables v1.0 is shipping.**
