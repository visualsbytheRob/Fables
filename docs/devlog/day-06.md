# Day 6–7 — Player, Library & the Fusion's Server Side (F541–F640)

**Shipped:** the phone-first story player + reader library (web), and entities/codex/journal
effects (server) — the first half of the knowledge↔story fusion. 1,242 tests green.

## Player & library (F541–F599, web)

- Distraction-free player: progressive text reveal, thumb-sized choices, autosave on every
  choice, continue-from-autosave entry, in-player menu, stat bars bound to story VARs,
  graceful runtime-error rendering.
- Presentation: four typography themes with live-preview gallery, per-story themes, text
  size/line-height controls, scene-tag backdrops, chapter title cards, tag-driven text
  effects, reduced-motion-aware transitions.
- History & rewind: choice drawer with tap-to-rewind (deterministic via seeds), bookmarks
  with notes, transcript reader + export-to-note, endings collection with hint toggle,
  branch explorer (% content seen), playthrough comparison diffs.
- Library: typographic cover grid, reading-progress badges, metadata editing, continue-
  reading rail, story detail pages, reading stats, archive, search.
- Read-aloud via Web Speech (voice/rate, per-paragraph highlight); accessibility pass
  (real buttons, aria-live text, focus management). Print stylesheet for transcripts.

## The fusion's server side (F601–F640)

- Entities: per-type field schemas (user-editable, seeded for character/place/item/faction),
  validated CRUD with field-naming errors, unique aliases wired into mention detection,
  typed relations as link rows, backing notes, schema introspection feeding the compiler —
  story builds now validate `@entity.field` refs against the real knowledge base.
- Codex: met-tracking per playthrough, revealed-facts model, spoiler-safety enforced and
  tested server-side (unrevealed fields never serialize), deterministic entry ids.
- Journal effects: batched VM effect ingestion with idempotency keys — journal events append
  to today's daily note with story links; entity mutations are schema-validated and audited;
  per-story journal opt-out.

## Deferred (unchecked, with owners)

F582–F584/F588–F589 (pack export formats → Epic 19), F590 Web Share, F591–F596 audio
(→ Epic 17), F603/F604/F607/F614–F615/F617 entity+codex UI, F633–F637 completion summaries
and annotations (web halves) — next lane closes the fusion UI loop.

## Plan amendment (user-approved)

Tier 2 upgraded: F1361–F1370 is now a **Claude cloud-LLM adapter** (opt-in, egress-explicit,
per-notebook exclusions) and F1861–F1870 a **ComfyUI generative-art adapter** (covers, entity
portraits, scene illustrations; local-first with Comfy Cloud opt-in). Count remains 2,000.
