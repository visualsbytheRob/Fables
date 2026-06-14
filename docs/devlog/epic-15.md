# Epic 15 — Importers & Interop (in progress)

Status as of 2026-06-14: **F1401–F1440 shipped** (import framework + Notion +
Apple Notes + Evernote). Next: F1441 (Roam / Logseq).

## Architecture

One **framework**, many thin **source adapters**. An adapter's only job is to
parse its format into the **staging IR** (`StagedDoc`: title, markdown body with
`{{asset:…}}`/`{{link:…}}` placeholders, notebook path, tags, assets, links). The
framework (`apps/server/src/import/framework/`) owns the rest:

- **Mapping engine** (F1402) — serializable rules: notebook strategy, tag prefix,
  collisions, root notebook.
- **Asset pipeline** (F1403) — content-addressed dedupe on disk + relinking.
- **Link reconstruction** (F1404) — two-pass: plan final titles (post-collision),
  then rewrite `{{link:id}}` → `[[Title]]`; notes go through the real `createNote`
  pipeline so links heal exactly like hand-authored ones.
- **Collisions** (F1406) — skip / rename / merge.
- **Provenance** (F1407), **resume** (F1405), **rollback** (F1408) — every
  artifact recorded per batch (migration `027-import-framework`).
- **Importer SDK + registry** (F1409) — adapters register by name; routes dispatch
  `/import/:source/*` automatically. Dry-run reports what _would_ happen + what's
  lossy, with no writes (F1401/F1418).

Routes: `GET /import/sources`, `POST /import/:source/{dry-run,run}`,
`GET /import/batches[/:id]`, `POST /import/batches/:id/rollback`,
`GET /notes/:id/provenance`.

## Importers shipped

- **Notion** (F1411–F1420): `.zip` (built a small dependency-free ZIP reader,
  `import/lib/zip.ts`, stored + deflate) or extracted folder; 32-hex page ids,
  nested child-page folders → notebooks, internal links → wikilinks, media →
  attachments, database CSVs → notebooks with a properties table + tag harvesting,
  relation/rollup + toggles/callouts flagged lossy.
- **Apple Notes** (F1421–F1430): via the Exporter app's `.enex`. Built the shared
  ENEX/ENML core (`import/lib/enex.ts`, `enml.ts`): ENML→markdown with checklists,
  tables, and `<en-media>` → assets matched by MD5. Folder→notebook, date
  preservation, locked-note detection + skip report.
- **Evernote** (F1431–F1440): reuses the ENEX/ENML core; note-attributes
  (web-clip source url, reminders), flat tags, resource hashes, and a **streaming**
  ENEX reader (`streamEnexNotes`) that yields notes from disk one at a time so
  multi-GB exports don't have to fit in memory.

## Honest limits (all surfaced in dry-run / docs)

Notion's own markdown export is pre-flattened (toggles/callouts/columns); ENEX has
no tag hierarchy or notebook stacks; encrypted/locked notes can't be read from any
export (detected + skipped). Each importer has a `docs/import-*.md` guide stating
exactly what maps and what doesn't.

## Tests

~2,538 green across 217 files at the F1440 checkpoint. Every importer is driven by
synthetic fixtures built in-process (no binary fixtures) — including hand-built
ZIP and ENEX documents.

## Retrospective (F1500) — Epic 15 complete

**Shipped:** F1401–F1500. One **import framework** (staging IR → mapping → asset
pipeline → link reconstruction → collisions → provenance/resume/rollback) feeding
**19 importers** (Notion, Apple Notes, Evernote, Roam, Logseq, Bear, Day One,
Simplenote, Google Keep, Standard Notes, Joplin, generic markdown, .docx, HTML,
CSV, OPML, ICS, email, plaintext); a mirror **export framework** with **6 targets**
(JSON, Obsidian, Notion-md, Logseq, static-site, pdf-book) and a real-CRC zip
writer; format-detection-on-drop; a universal CLI; health reports + a vault-wide
link audit; fuzz hardening; a memory ceiling; local telemetry; and a per-source
fidelity scoreboard.

**What went well.** The "thin adapter, fat framework" split was the whole game:
each importer only parses its format into `StagedDoc`, and the framework does
everything hard exactly once. Two shared cores paid for themselves many times over
— the ENEX/ENML core (Apple Notes + Evernote) and the outliner model (Roam +
Logseq). Building dependency-free **ZIP read/write** and a **tar reader** kept the
"no heavy deps" ethos intact and unlocked .zip/.jex/.docx with hand-built test
fixtures (no copyrighted sample data in the repo). The **parallel agent teams**
(Opus orchestrator + 2 Sonnet code lanes + Haiku docs) shipped the seven document
importers and all six export targets cleanly because every adapter lives in its own
directory — the only collisions were the registry/routes, which the orchestrator
owned.

**Decisions.** Every import is reversible (provenance + one-click rollback) and
preview-first (dry-run with a lossy report) — trust before writes. Unresolved
import links stay real `[[wikilinks]]` so they heal later rather than degrading to
plain text. Honesty over optics: format-inherent losses (ENEX has no tag
hierarchy; Notion pre-flattens toggles; locked notes are unreadable) are detected,
skipped where needed, and surfaced — never faked.

**Deferred (web UI).** The import wizard, mapping-preview, progress, error-triage,
and post-import-tour screens (F1481–F1485, F1489) are queued for the web-UI pass;
the server pipeline they drive (detect → dry-run → run → health → rollback) is all
shipped and tested. PDF export is a print-ready HTML book until there's a
server-side PDF renderer.

**The recurring tax.** The agent Write tool kept corrupting spaces into NUL bytes
inside regexes; caught by lint (`no-control-regex`) every time, fixed by hand. A
known quirk to keep watching.

**Counts.** ~2,791 tests green across 240 files at the F1500 checkpoint. Epic 15
done; next is Epic 16 (Canvas & Spatial Views).
