# Importing from Apple Notes

Apple Notes has **no first-party bulk export**, so any honest guide has to be
upfront about the options and their trade-offs.

## The honest export options

| Option                         | Gets you                                                                  | Trade-offs                                            |
| ------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Exporter app** (recommended) | One `.enex` per folder, with images, scans, checklists, tables, and dates | A paid third-party app; the most complete export      |
| **Share → Export PDF**         | A PDF per note                                                            | Not re-editable; loses structure — only for archival  |
| **Copy/paste into Markdown**   | Per-note markdown                                                         | Manual; fine for a handful of notes                   |
| **Notes → Export as iCloud**   | Nothing usable in bulk                                                    | Apple provides no `.enex`/markdown bulk path natively |

Fables ingests the **Exporter** route: `.enex` (the Evernote interchange format),
which is the richest machine-readable option Apple Notes can produce.

## Steps (Exporter app)

1. Install the **Exporter** app and point it at Apple Notes.
2. Export as **ENEX**, one file per folder, including attachments.
3. You'll get a folder of `.enex` files (one per Notes folder).

## Run the import

```
POST /api/v1/import/apple-notes/dry-run  { "input": { "path": "/abs/path/to/enex-folder" } }
POST /api/v1/import/apple-notes/run      { "input": { "path": "/abs/path/to/enex-folder" } }
```

`path` can be the folder of `.enex` files or a single `.enex`. Dry-run first; the
`run` returns a `batchId` you can roll back.

## What maps, and how

| Apple Notes               | Fables                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| Folder (one `.enex` file) | Notebook (named after the file).                                  |
| Note                      | Note, with original created/updated dates preserved.              |
| Checklists                | Markdown task lists (`- [ ]` / `- [x]`).                          |
| Tables                    | Markdown tables.                                                  |
| Inline images & scans     | Attachments in the content-addressed store, relinked in the body. |
| Tags (if present)         | Fables tags.                                                      |

## Locked notes

Locked (encrypted) notes **cannot** be read from an export — the bytes are
ciphertext. Fables detects them, **skips** them rather than importing garbage, and
lists their titles in the skip report so you know exactly which notes to unlock and
re-export if you want them.

## Limits

Apple Notes doesn't export cross-note links in a resolvable form, so internal
links aren't reconstructed (the text is preserved). Drawings/handwriting export as
images.
