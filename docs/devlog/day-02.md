# Day 2 — Notes Core (F101–F200) ✅ (+ Day 3 server lane F201–F240)

**Shipped:** the app became a real notes tool. Built with two parallel agent lanes
(server / web) per the updated protocol, merged and verified by the orchestrator.

## What exists now

- **Notes API:** full CRUD with keyset pagination, optimistic concurrency (409 + conflict
  UX), trash/restore/purge (30-day boot sweep), duplicate, bulk ops.
- **Revisions:** content-hash-deduped snapshots, keep-all-24h-then-daily pruning,
  restore-to-revision, server-computed word-level diffs, 1MB body guard.
- **The notes UI:** three-pane layout (notebook tree | windowed note list | editor+preview)
  that collapses cleanly to phone width. CodeMirror markdown editor with toolbar,
  shortcuts, smart lists, image paste→upload; sanitized GFM preview with interactive task
  checkboxes, KaTeX, TOC, synced-scroll split view.
- **Organization:** nested notebooks (drag re-parent, archive, delete-with-rehome, badges,
  breadcrumbs), tags (#autocomplete, AND/OR filtering, nesting, merge, colors), attachments
  (content-addressed uploads, lightbox/PDF/audio rendering, manager page).
- **Flow:** debounced autosave with rev tracking + conflict dialog, revision history panel
  with side-by-side diffs, draft recovery, quick capture (⌘⇧N), quick switcher (⌘P), focus
  mode, word count, export/copy, `?` cheat sheet, global command registry feeding ⌘K.
- **Day 3 server lane (ahead of schedule):** wikilink parser (aliases/#heading/^block),
  link table maintenance with rename rewriting + broken-link healing, backlinks API with
  context snippets, incremental unlinked-mention detection + one-click conversion, graph
  API (filters, BFS local graphs, communities, weighted edges, JSON/GraphML export, ~50ms
  on a 1k-note fixture). Migration 005.

## Numbers

287 tests (170 → 287 this day), typecheck/lint/build green, entry bundle 89KB gzip
(editor stack lazy-loaded). Live smoke test against the real server passed.

## Decisions & deferrals

- F137 mermaid deferred (dep not installed); setting stubbed.
- F187 deep undo-history deferred (CM default history + draft recovery cover it).
- F194 focus mode shipped without typewriter scrolling.
- Notebook "reorder" = re-parent (no sort-order column yet).
- List tag chips derive from body hashtags client-side; `GET /notes` may later include tags.
- Six Day-3 UI halves (F203/204/212/215/218/223) await the Day 3 web lane.
- Bundle budget script now measures initial-load JS (entry chunks) with a 2MB total cap —
  summing lazy chunks penalized code-splitting, which is backwards.

## Next

Day 3 web lane (graph view UI, daily notes, templates, + the six UI halves) and the
FQL/saved-queries/import-export server lane (F271–F300).
