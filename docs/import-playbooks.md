# Migration-day playbooks

Moving your whole notes life into Fables? These per-source checklists keep it calm
and reversible. The golden rule for every source: **dry-run, run, check health,
keep or roll back.**

## The universal flow (every source)

1. **Export** from the source app (see its guide in `docs/import-*.md`).
2. **Dry-run** — see exactly what will happen, with no writes:
   `POST /api/v1/import/<source>/dry-run { "input": { "path": "/abs/path" } }`
   (or the CLI: `pnpm --filter @fables/server import -- <source> <path> --dry-run`).
3. **Run** it: `POST /api/v1/import/<source>/run` → returns a `batchId`.
4. **Check health:** `GET /api/v1/import/batches/<batchId>/health` — look at
   `linkResolutionPct` and the note/attachment counts.
5. **Keep it, or undo it:** not happy? `POST /api/v1/import/batches/<batchId>/rollback`
   removes everything that batch created. Interrupted? Re-run with the same
   `batchId` to resume.

Don't know which importer to use? `GET /api/v1/import/detect?path=<abs path>` ranks
the right ones for what you dropped.

## Per-source checklists

### Notion

- [ ] Export **Markdown & CSV**, include subpages + files; keep the `.zip` intact.
- [ ] Dry-run; review the **lossy** list (toggles/callouts/columns are pre-flattened by Notion).
- [ ] Run; check that database pages landed under their notebook with a Properties table.

### Evernote / Apple Notes (ENEX)

- [ ] Evernote: export each notebook as **ENEX**. Apple Notes: use the **Exporter** app → ENEX.
- [ ] Expect **locked/encrypted notes to be skipped** (they're listed) — unlock + re-export if needed.
- [ ] Run; confirm attachments came across and dates are preserved.

### Roam / Logseq

- [ ] Roam: **Export All → JSON**. Logseq: point at the graph directory.
- [ ] Decide `namespaces: "nest"` (A/B/C → nested notebooks) vs `"flat"`.
- [ ] After run, spot-check that `((block refs))` became page links with `^uid` anchors.

### Day One / journaling apps

- [ ] Export **JSON**; keep the `photos/` folder beside the journal `.json`.
- [ ] Entries land under a **Journal** notebook with location/weather metadata.

### Everything else (Bear, Simplenote, Keep, Standard Notes, Joplin, plain markdown)

- [ ] See each source's guide; the universal flow above applies unchanged.
- [ ] For a generic folder of markdown, use the `markdown` source (it reads common
      frontmatter dialects).

## Big migrations

- Use the **CLI** for very large vaults: `pnpm --filter @fables/server import -- <source> <path>`.
- Imports are **resumable** — if one is interrupted, re-run with the same `batchId`.
- Living source (a folder you keep adding to)? Re-running the same batch picks up
  **new** documents (changed-in-place updates are a future enhancement).
- A low `linkResolutionPct` in the health report usually means you exported a
  _subset_; importing the rest of the linked notes will resolve the gaps.
