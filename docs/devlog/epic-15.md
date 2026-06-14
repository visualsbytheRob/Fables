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
