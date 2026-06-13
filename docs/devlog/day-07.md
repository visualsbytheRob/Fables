# Day 7 — The Fusion comes alive in the app (web halves)

**Shipped:** the web halves of the knowledge↔story fusion. Entities are now editable in the
app, the codex and lore embeds come alive in the player, story completion writes a journal
summary, readers can annotate passages into linked notes, the playtest pane can simulate
knowledge state, and there is a hand-written Aesop demo world plus a first-run tour.
1,339 tests green (up from 1,242); typecheck, lint, build and bundle-size all green.

Built by three parallel agent lanes over disjoint files (entities / player / stories+demo),
plus a shared foundation (API client entity+codex types, routes, sidebar) merged by hand.

## Entity editor UI (F603/F604/F607)

- `/entities` route + sidebar/palette entry. Gallery per type (character/place/item/faction/
  custom) with type-icon cards, name search wired to the list endpoint, empty states.
- Create-from-schema dialog: fetches the type schema and prefills defaults per field.
- Detail editor: schema-driven field controls (number/string/bool/list), markdown body via a
  create-on-demand backing note (live MarkdownPreview), alias add/remove, relation pickers
  (entity search) with incoming relations shown read-only, and delete-with-mention-warning.
- Pure field parse/format/defaults logic factored into `fieldEditors.ts` (tested).

## Codex + lore + journal in the player (F614/F615/F617, F621–F630, F633/F635–F637)

- The player now runs the VM with a real host built from the loaded entities + note index.
  `@entity` displays become tappable codex links and fire encounter events; `@entity.field`
  reads serve live values and fire encounter+reveal; `[[lore]]` refs become tappable links.
- Effects dispatcher wired: one idempotent batch per turn (encounter/reveal/journal/
  entity_set), an offline queue that retries on reconnect, keys that collide on rewind so the
  server replays rather than double-applies.
- Codex slide-over: met entities only, newest first, search + type filters, a pulsing badge
  when new entries land, each row expanding to a spoiler-safe entity card (revealed fields
  only). Tapping an `@entity` opens its card if met (else inert — never a spoiler).
- Lore popover: depth-capped MarkdownPreview of the referenced note; nested `[[refs]]` open
  nested popovers up to the cap; a deleted note degrades to an inert link with a tooltip
  (stale-ref handling). Lore links are styled distinctly from choices; visits tracked in
  localStorage and dim already-read links.
- Author-side lore panel: a third workspace side-pane tab listing every `[[note]]` and
  `@entity` ref in the current file, click-to-jump. Broken-binding diagnostics (FORGE204/205/
  309/108) verified to reach the problems panel by test.
- Journal: a playthrough-summary journal event on completion; reader annotations (select text →
  create a linked note via the notes API with story context + a `?turn=` back-link) with an
  annotation review sheet listing every annotation across playthroughs; `?turn=` deep links
  resolve in-place by rewinding the live run.

## Playtest knowledge simulation (F646/F647)

- A "knowledge" section in the playtest state editor injects mock `@entity.field` values as VM
  external state via a sim host. Any unmocked entity-field read during a sim/scenario run is
  flagged as a *live binding* (a determinism risk), surfaced as a per-scenario chip and a
  warning line.

## Demo content + tour (F691–F693/F697)

- `docs/demo/aesop/` — "The Aesop Engine": a README plus two compiling `.fable` stories
  (`fox-and-crow.fable` annotated with `[[lore]]` + `@entity`/`@entity.field`; `crossroads.fable`
  branching with `@journal` + codex reveals across branches). Both verified to compile by test.
- A dismissible 5-step first-run tour overlay, keyed off localStorage, mounted in the app shell.

## Decisions & deferrals

- The player loads all entities + a note-title index once per session (snapshot at start) and
  builds the host from it; a failed knowledge load still plays, with `@entity` falling back to
  plain text and `[[lore]]` inert. Auto-start waits for the knowledge load to settle so the
  opening passage already binds.
- Annotation notes land in an "Annotations" notebook (created on demand); the registry tying a
  note back to its story moment lives in localStorage per story.
- `ENTITY_SET` as a Forge effect is not recognised by the client-side compiler (FORGE203), so
  the branching demo uses a `VAR` + `@journal` for mutation rather than an `ENTITY_SET` effect.
  Documented in the demo README.
- **Deferred:** F624 (compile-time note/entity existence validation — compiler half), F634
  (author-tagged decision log), F694–F696 (demo journal/queries/graph arrangement), F698
  (`pnpm seed:demo` one-command install), F699 (full play+mutate+journal e2e — only the
  compile check shipped). F700 retro = this devlog.

## Fusion UIs wave (F651–F660, F681–F690) — the browser views

The previous wave shipped the fusion *backends* and noted "their browser UIs are the next web
wave." This wave built them, in two disjoint web lanes plus a box-reconciliation pass.

- **Timeline** (`apps/web/src/timeline/`, F651–F660): `/timeline` page. Vertical day-grouped
  feed merging note/story/playthrough events, type-filter chips, day/week/month/year zoom
  (pure client-side `rebucket`), per-row click-through (`rowHref`), cursor "load more", and an
  "Export chronicle" button wiring `POST /timeline/export`. Pure helpers (`formatDayHeading`,
  `rowHref`, `bucketKey`, `rebucket`, `filterByTypes`) are unit-tested (21 assertions).
- **World inspector** (`apps/web/src/world/`, F681–F690): `/world` page. Tabs for the
  mutated-field dashboard (provenance highlighting), per-entity mutation history, per-field /
  per-entity revert, named snapshots with two-snapshot diff, mutation-conflict surfacing, and
  JSON export/import. Added the missing server half for F688 (`exportWorld`/`importWorld` +
  `GET /world/export`, `POST /world/import`, with route tests). Pure web helpers unit-tested.
- Both pages wired into `App.tsx` routes + sidebar nav (Timeline = `History` icon, World =
  `Layers` icon).
- **Box reconciliation:** the prior "scaffolding" recovery had left most F601–F690 boxes
  unchecked even though the code, tests, and wiring were already complete. Audited each against
  the implementation and checked the genuinely-done ones; the rest are marked `[~]` deferred
  with one-line reasons (see FEATURES.md).

## Deferrals from this wave

- Cross-reference *panel* UI (F661, F668) and graph-view integration / presets (F666, F667):
  the `/refs`, `/dependencies`, `/impact` backends + grouping are done and tested; the browser
  panels and typed-edge graph layering are not yet built.
- In-notes transclusion *render* (F673, F674, F676–F678): server resolution + compile-time
  inlining (F671/F672/F675/F679/F680) are done; live rendering of `![[note^block]]` /
  `![[@hero]]` / FQL embeds inside the note markdown preview is not yet wired.
- Per-story chronology *view* (F656): endpoint + client method shipped; dedicated view not
  rendered (the unified timeline covers the cross-cutting feed).

## Concurrency note (handoff)

This session ran concurrently with another agent driving Day-8 (FTS search F701+, insights,
related-panel). That agent's work is present in the working tree **uncommitted** (`search/`,
`insights/`, `011-fts` migration, `RelatedPanel`, plus edits to `api/client.ts`,
`routes/index.ts`, `packages/ui`, etc.) and only partially green — two search test files use
`@testing-library/jest-dom` matchers with no jest-dom setup installed (offline container).
Day-8 boxes are intentionally **not** checked. Whoever commits next should make the combined
tree green (either add jest-dom dev-dep + setup, or convert those two test files to plain DOM
assertions) before checking any F701+ box.
