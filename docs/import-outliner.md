# Importing from Roam Research & Logseq

Roam and Logseq are block **outliners**: every page is a tree of bullets, blocks
have stable ids, and you link both pages (`[[Page]]`) and individual blocks
(`((uid))`). Fables imports both through one shared outliner pipeline.

## Exporting

- **Roam:** _••• → Export All → JSON_. You get one `.json` file.
- **Logseq:** your graph is already a folder of markdown under `pages/` and
  `journals/`. Point Fables at the graph directory.

## Run the import

```
POST /api/v1/import/roam/run     { "input": { "path": "/abs/roam-export.json", "namespaces": "nest" } }
POST /api/v1/import/logseq/run   { "input": { "path": "/abs/logseq-graph", "namespaces": "flat" } }
```

Dry-run first; `run` returns a rollback-able `batchId`.

## What maps, and how

| Outliner                      | Fables                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Page                          | Note.                                                                          |
| Bullet tree / indentation     | Nested markdown bullet list (structure preserved).                             |
| `[[Page]]` links              | `[[wikilinks]]` — they heal even if the target imports later.                  |
| Block ids (`((uid))` targets) | A trailing `^uid` anchor on the referenced block, so links stay valid.         |
| `((uid))` block references    | A link to the block's **owning page** (navigable), with the block anchored.    |
| `#tag` / `#[[tag]]`           | Fables tags.                                                                   |
| Daily notes                   | Filed under a **Journal** notebook, with the note's date preserved.            |
| Namespaces (`A/B/C`)          | Nested notebooks when `namespaces: "nest"`; otherwise the title is kept whole. |
| `{{query …}}`                 | Best-effort **FQL** in a code block, with the original flagged as lossy.       |

## Honest limits (shown in the dry-run report)

- **Block references** become _page_ links plus a `^uid` anchor — navigable and
  link-stable, but not pixel-exact inline block transclusion. Each is flagged
  lossy so you can review them.
- **Queries** are dynamic in Roam/Logseq; Fables translates the obvious page/tag
  filters to FQL and leaves the original in a code block. Complex queries are
  flagged for manual review.
- **Logseq markdown** is fully supported; **`.org`** files are parsed
  best-effort (bullet structure) — org-specific syntax isn't reproduced.
