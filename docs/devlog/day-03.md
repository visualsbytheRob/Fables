# Day 3 — Linking, Graph, Queries & the Day-2 UI (F141–F300, parallel lanes)

**Shipped across two parallel waves:** the complete notes experience (F141–F200), the linking
engine + graph (F201–F250), daily notes & templates (F251–F270), and the FQL query language +
import/export server side (F271–F300, UI halves pending).

## What exists now

- **Notes UI complete:** three-pane layout (notebook tree | list | editor+preview), tags with
  autocomplete, attachments manager, autosave with 409-conflict resolution, revision history
  with diffs, quick capture, focus mode, command-palette actions, keyboard cheat sheet.
- **Linking engine:** wikilink parser (aliases, #heading, ^block), rename propagation,
  broken-link self-healing, backlinks with context snippets, unlinked-mention detection +
  one-click conversion — wired into editor autocomplete (`[[`), click-to-navigate, and a
  backlinks/mentions panel.
- **Graph:** canvas force-graph with pan/zoom/drag, type/cluster styling, local graph per note,
  filters, search-and-center; server provides degree/orphan/community metadata, weighted edges,
  caching, JSON/GraphML export (~50ms on 1k notes).
- **Daily notes:** Today command, calendar month navigation, daily template, streaks,
  yesterday/tomorrow nav, week view, on-this-day resurfacing.
- **Templates:** template notebook convention, `{{date}}/{{title}}/{{cursor}}` variables,
  prompted custom variables, insert-at-cursor, entity/scene builtins, management page.
- **FQL v0 (server):** tokenizer → parser → SQL compiler with `tag:` `notebook:` `before:`
  field/date filters, booleans, sort directives, helpful errors, snapshot test suite.
- **Saved queries (server) + import/export:** saved-query CRUD; markdown-folder and
  Obsidian-vault importers with frontmatter handling, dry-run reports, duplicate strategies;
  full vault export; round-trip fidelity tests; CLI import command for huge vaults.

## Deferred to the next lane (boxes left unchecked)

- F278 FQL query-bar UI, F282–F290 saved-query sidebar/embeds/dashboard UI, F297 import
  progress UI. The server contracts they need are all live.
- F137 mermaid rendering (dependency not installed) — still parked.

## Notes & incidents

- Two red CI runs (7287a31, 5d5b58d) were caused by the old bundle-size checker capping _total_
  JS while CodeMirror ships ~100 lazy language chunks; the checker now budgets initial-load JS
  (350KB) with a 2MB total cap, and CI is green on HEAD.
- Agent sessions can be cut off by usage-limit resets mid-task; work is recovered by verifying
  the tree and committing what's demonstrably done. Boxes are only checked with evidence.

**Suite at close: 377 tests, all green. 233/2000 features.**
