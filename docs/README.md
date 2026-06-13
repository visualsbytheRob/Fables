# Fables Documentation

Welcome to Fables — a personal Knowledge OS fused with an interactive fiction engine. This documentation hub guides you through using, building with, and deploying Fables.

---

## For New Users

**Start here if you're new to Fables.**

- **[Getting Started](guide/getting-started.md)** — Installation, first note, and the five-minute tour.
- **[Tailscale Setup](tailscale.md)** — How to serve Fables over your tailnet and access it from iPhone.
- **[Troubleshooting](troubleshooting.md)** — Common issues and solutions.

---

## For Story Authors

**Learn to write interactive fiction in the Forge language.**

- **[Forge Language Tutorial](forge/tutorial.md)** — Zero to your first story in ten steps. Start here.
- **[Forge Language Spec](forge/spec.md)** — Complete language reference: scenes, choices, variables, diverts, knowledge bindings, and all syntax.
- **[Forge Conformance Checklist](forge/conformance.md)** — Comprehensive feature matrix and grammar (for implementers and spec readers).

---

## For Knowledge Base Authors

**Learn to build and explore your personal Knowledge OS.**

- **[Fusion Cookbook](cookbook/fusion.md)** — Ten recipes for blending notes with stories: entity cards, journal effects, world state, codex reveals, and more.

---

## For Operators & Administrators

**Deploy and maintain Fables on your infrastructure.**

- **[Security & Privacy](security.md)** — Threat model, what data lives where, encryption, and best practices. Read this before deploying.
- **[Tailscale Integration](tailscale.md)** — Complete setup: serve over your tailnet with HTTPS, install the PWA on iPhone.
- **[Disaster Recovery Runbook](runbooks/disaster-recovery.md)** — Backup restoration and data recovery procedures.
- **[Rollback Runbook](runbooks/rollback.md)** — How to revert to a previous version safely.
- **[Troubleshooting](troubleshooting.md)** — Debug logs, sync health, common problems.

---

## For Contributors & Developers

**Understand Fables' architecture and contribute to the codebase.**

- **[Architecture](architecture.md)** — System overview: monorepo structure, data model, server and web app, offline-first sync, fusion layer. Read this first.
- **[Plugin Architecture Concepts](plugins/concepts.md)** — The Fables plugin system design (Tier 2). What plugins are, how they work, the security model, and what they can do.
- **[Real-Time Collaboration Concepts](collaboration/concepts.md)** — Fables collaboration design (Tier 2): CRDTs and Yjs, shared editing, WebSocket rooms, presence, comments, and how it fits the local-first model.

---

## Announcements & Milestones

- **[v1.0 Announcement](announcement.md)** — What Fables is and why it exists.

---

## Build Logs & Retrospectives

**Follow the daily progress of Fables development.**

### Tier 1 — Core Knowledge OS + Forge Engine (Days 1–10)

- **[Day 1: Foundation & Monorepo](devlog/day-01.md)**
- **[Day 2: Notes Core](devlog/day-02.md)**
- **[Day 3: Linking, Graph & Queries](devlog/day-03.md)**
- **[Day 4: Forge DSL — Language & Compiler Front-End](devlog/day-04.md)**
- **[Day 5: Compiler Back-End & VM](devlog/day-05.md)**
- **[Day 6: Story Authoring & Player](devlog/day-06.md)**
- **[Day 7: The Fusion — Knowledge ↔ Story](devlog/day-07.md)**
- **[Day 8: Search & Intelligence](devlog/day-08.md)**
- **[Day 9: PWA, Offline, Sync & Tailscale](devlog/day-09.md)**
- **[Day 10: Hardening, Tests, Perf & Ship](devlog/day-10.md)**
- **[Tier 1 Retrospective](devlog/tier-1-retrospective.md)** — Lessons learned building 1,000 features in 10 days.

### Tier 2 — Stretch Epics

- **[Epic 11: Plugin & Extension Architecture](devlog/epic-11.md)** — Sandboxed worker-thread plugins with capability model, SDK, and distribution pipeline.

---

## Quick Links

- **README** — Main project overview and quickstart (in the root of the repo).
- **FEATURES.md** — Canonical feature checklist: Tier 1 (complete) and Tier 2 epics (in progress).
- **CLAUDE.md** — Instructions for Claude Code sessions building Fables.

---

## What Is Fables?

**Fables** is your knowledge base on your machine, fused with an interactive fiction engine you own.

- **Your notes are the world.** Write markdown notes and organize them into notebooks, tags, and links. Fables learns relationships, suggests connections, and never locks your data.
- **Your stories run on a compiler you own.** Author interactive fiction in the Forge language (inspired by Ink). Compile to bytecode, play on your phone PWA, and let stories mutate your entities and journal.
- **Offline-first, synced over Tailscale.** Work on your Mac or Linux machine. Serve the web app over your tailnet to your iPhone via `tailscale serve`. Edit offline, sync when you're back. No cloud required.

---

**Last updated:** Day 10 (June 13, 2026). This documentation describes Fables v1.0 (Tier 1 complete, Tier 2 in progress).
