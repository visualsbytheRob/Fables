# Importing from Notion

Fables imports a Notion **"Markdown & CSV"** export — the format Notion gives you
from _Settings → Export_ (or a page's _••• → Export_). Point Fables at either the
downloaded `.zip` or an already-extracted folder.

## How to export from Notion

1. In Notion: top-level _••• → Export_ (or workspace _Settings → Export all
   workspace content_).
2. Choose **Markdown & CSV**, include subpages, and (optionally) include files.
3. Download the `.zip`. Don't rename the inner files — Fables relies on Notion's
   page-id suffixes to reconstruct links and hierarchy.

## Run the import

```
POST /api/v1/import/notion/dry-run   { "input": { "path": "/abs/path/to/export.zip" } }
POST /api/v1/import/notion/run       { "input": { "path": "/abs/path/to/export.zip" },
                                       "rules": { "collisions": "rename" } }
```

Always **dry-run first**: it reports every page, where it will land, and anything
that won't map cleanly — with no writes. The `run` returns a `batchId` you can
**roll back** in one call (`POST /api/v1/import/batches/:id/rollback`) if you don't
like the result. Interrupted runs **resume** by passing the same `batchId`.

## What maps, and how

| Notion                       | Fables                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Page (`.md`)                 | Note. The page-id suffix is stripped from the title and kept as provenance.                                                  |
| Nested subpages              | Notebook hierarchy (the parent-page folders become notebooks).                                                               |
| Internal page links          | `[[wikilinks]]` to the right note — resolved even across the whole import.                                                   |
| Images / files               | Attachments in the content-addressed store, relinked in the body.                                                            |
| Database (`.csv` + folder)   | A notebook of notes; each row's properties render as a **Properties** table; `Tags`/multi-select columns become Fables tags. |
| Relation / rollup properties | Rendered as text and flagged as lossy (Notion doesn't export the linked records as data).                                    |

## Honest limits (shown in the dry-run report)

Notion's _own_ Markdown export is already lossy before Fables sees it:

- **Callouts** arrive as block quotes; **toggles** are flattened; **columns**
  become sequential content. Fables flags these as lossy rather than pretending
  to round-trip them.
- **Relation/rollup** values are plain text, not live links.
- Databases import as notebooks of notes (with properties). Mapping a database to
  structured **entities** instead is a planned option.

Everything flagged lossy appears in the dry-run report's per-page `lossy` list and
the report totals, so you know exactly what you're getting before you commit.
