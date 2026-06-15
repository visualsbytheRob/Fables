# The Fables Book

> A narrative tour of the whole system, told in the order you'd actually meet it.
> Not a reference — for that, follow the links. This is the story of what Fables
> is and how its pieces fit.

## I. A note is a world

Everything starts with a note. You write in markdown; Fables renders it,
versions every change, and links it to everything else. Type `[[a title]]` and
you've drawn an edge in a graph that the whole system can see — backlinks,
mentions, a navigable map of your thinking. Notes live in notebooks, carry tags,
and answer to a query language.

That query language is **FQL**. `tag:meeting updated:>30d sort:created desc`
finds what you mean. In v2 it learned to count and group
([FQL v2](fql-v2.md)): ask for notes-per-notebook, average length, words-per-
month, and it answers with aggregates — and `EXPLAIN` tells you how it got there
before you run it.

## II. A story runs on a compiler you own

The second half of Fables is **Forge** — a small interactive-fiction language
with its own compiler and bytecode VM ([the tutorial](forge/tutorial.md)). Scenes,
choices, variables, diverts. The twist is fusion: a Forge story can read and
write your knowledge base. A character card is a note; a story effect updates
world state; a codex entry reveals itself as the reader plays. Your notes are
the world the story runs in ([the fusion cookbook](cookbook/fusion.md)).

Stories travel. A `.fablepack` is a deterministic, signed bundle; a
`.fablearchive` adds fixity for preservation; Ink and Twee import in
([distribution](distribution/guide.md)).

## III. The vault remembers, safely

Your data lives in `~/.fables`, on your machine. Turn on the **vault** and titles
and bodies are encrypted at rest (Argon2id + XChaCha20-Poly1305), with a
tamper-evident audit log and a compliance backend ([security](security.md)). With
v2 you can run **more than one vault** — Work, Personal, Worldbuilding — each
isolated, each with its own settings and encryption state, one active at a time
([multi-vault](multi-vault.md)).

## IV. The system acts on its own

A knowledge base that only sits there is a filing cabinet. Fables v2 acts:

- **Automation rules** watch for events (a note created, tagged) and run actions
  (tag, move, notify) — with a dry-run that shows the diff first.
- **Scheduled jobs** run on cron: backups, digests, reindexing.
- **Webhooks** reach out when something changes and capture from anywhere an iOS
  Shortcut can POST ([webhooks](webhooks.md)).
- **The scripting console** automates against the same capability surface as
  plugins, scoped and dry-run-checked ([scripting](scripting.md)).

## V. Power tools for a big vault

When a vault grows, you need leverage. **Bulk operations** reshape many notes at
once — find/replace, merge, split, retag — with a preview and a reversible
journal ([bulk operations](bulk-operations.md)). **Power tools** keep it healthy:
statistics, a duplicate finder, a broken-everything finder, a linter with
fix-its, a storage analyzer ([power tools](power-tools.md)). **Workspace
profiles** save the shape of your screen — a reading mode for the evening, a
writing mode for the morning ([workspace profiles](workspace-profiles.md)).

## VI. Extending and sharing

**Plugins** run in worker-thread sandboxes with capability permissions
([plugin concepts](plugins/concepts.md)). **Collaboration** brings CRDT shared
editing, still local-first ([collaboration](collaboration/concepts.md)). **AI**
assists are pluggable and consent-gated ([AI](ai.md)). **Importers** bring your
past in from Notion, Evernote, Apple Notes and more.

## VII. In your pocket

Fables is a PWA. Serve it over your tailnet with `tailscale serve`, install it
on your iPhone, and the whole system — notes, stories, vault, automation — is in
your pocket, offline-capable, syncing through an op-log when you reconnect
([Tailscale setup](tailscale.md)).

---

That's the system: a place to think that runs a language you own, remembers
safely, acts on its own, and goes where you go. Start with
[Getting Started](guide/getting-started.md).
