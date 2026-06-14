# Interop hub — bring it in, take it out

Fables believes your data is _yours_: easy to bring in, and never held hostage.
This is the map of everything in Epic 15.

## Import

One framework, many sources. Every import is a **dry-run → run → health-check →
keep-or-rollback** loop, with provenance on every note and resume on interruption.

- **Guides:** [Notion](./import-notion.md) · [Apple Notes](./import-apple-notes.md) ·
  [Evernote](./import-evernote.md) · [Roam / Logseq](./import-outliner.md) ·
  [Bear / Day One / Simplenote / Keep / Standard Notes / Joplin / markdown](./import-misc.md) ·
  [Documents (.docx, HTML, CSV, OPML, ICS, email, text)](./import-documents.md)
- **Playbooks:** [migration-day checklists](./import-playbooks.md)
- **API:** `GET /import/sources`, `GET /import/detect?path=…`,
  `POST /import/:source/{dry-run,run}`, `GET /import/batches/:id/health`,
  `GET /import/audit`, `POST /import/batches/:id/rollback`,
  `GET /notes/:id/provenance`
- **CLI:** `pnpm --filter @fables/server import -- <source> <path> [--dry-run …]`

## Export

The mirror image — [export guide](./export.md). Harvest all notes, one notebook,
or an FQL selection, into any format, as a folder or a `.zip`:
JSON (lossless), Obsidian, Notion, Logseq, a static HTML site, or a print-ready
PDF book. `GET /export/targets`, `POST /export/:target`.

## Fidelity scoreboard — what survives, per source

✅ full · ◐ partial / lossy (flagged in the dry-run) · — not present in that export

| Source                                         | Notes | Notebooks | Tags | Attachments | Internal links | Dates | Notes                                                        |
| ---------------------------------------------- | :---: | :-------: | :--: | :---------: | :------------: | :---: | ------------------------------------------------------------ |
| Notion                                         |  ✅   |    ✅     |  ◐   |     ✅      |       ✅       |   ◐   | DB props → table; toggles/callouts pre-flattened by Notion   |
| Apple Notes                                    |  ✅   |    ✅     |  ✅  |     ✅      |       —        |  ✅   | locked notes skipped (reported); no cross-note links in ENEX |
| Evernote                                       |  ✅   |    ✅     |  ◐   |     ✅      |       —        |  ✅   | flat tags only; web-clips simplified; reminders kept         |
| Roam                                           |  ✅   |     ◐     |  ✅  |      —      |       ✅       |  ✅   | block refs → page links + `^uid`; queries → best-effort FQL  |
| Logseq                                         |  ✅   |     ◐     |  ✅  |      —      |       ✅       |  ✅   | md full; `.org` best-effort                                  |
| Bear                                           |  ✅   |     ◐     |  ✅  |     ✅      |       ✅       |   —   | nested + multi-word tags                                     |
| Day One                                        |  ✅   |    ✅     |  ✅  |     ✅      |       —        |  ✅   | location/weather/starred as metadata                         |
| Simplenote                                     |  ✅   |     —     |  ✅  |      —      |       —        |  ✅   | first line → title                                           |
| Google Keep                                    |  ✅   |     —     |  ✅  |     ✅      |       —        |  ✅   | lists → checkboxes; pinned/archived as tags                  |
| Standard Notes                                 |  ✅   |     —     |  ✅  |      —      |       —        |  ✅   | tags resolved from references                                |
| Joplin                                         |  ✅   |    ✅     |  —   |     ✅      |       —        |  ✅   | `.jex` tarball; resources relinked                           |
| Markdown (generic)                             |  ✅   |    ✅     |  ✅  |     ✅      |       ✅       |  ✅   | reads common frontmatter dialects                            |
| .docx / HTML / CSV / OPML / ICS / email / text |  ✅   |     ◐     |  ◐   |      ◐      |       ◐        |   ◐   | per the [documents guide](./import-documents.md)             |

> Every ◐ is surfaced in that import's **dry-run report** before you commit, so
> there are no silent surprises. A round-trip fidelity test (export → import →
> compare) guards the export side against loss.

## Robustness

- **Fuzz-tested:** every importer fails _cleanly_ on malformed input — it never
  crashes the process.
- **Bounded:** imports above a safety ceiling are refused rather than risking
  out-of-memory.
- **Local telemetry:** failure patterns are summarized on-device only, never sent
  anywhere.
- **All fixtures are synthetic:** test corpora are built in-process (hand-written
  ZIP/ENEX/tar bytes, JSON literals) — no third-party copyrighted sample data
  ships in this repo.
