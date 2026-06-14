# Importing from Evernote

Evernote exports the **`.enex`** format — one file per notebook. Fables imports a
single `.enex` or a whole folder of them.

## How to export from Evernote

1. In Evernote, select a notebook → _Export notebook…_ → **ENEX**. Repeat per
   notebook, or use the desktop app's bulk export to a folder.
2. You'll get one `.enex` file per notebook (filename = notebook name).

## Run the import

```
POST /api/v1/import/evernote/dry-run  { "input": { "path": "/abs/path/to/enex-folder" } }
POST /api/v1/import/evernote/run      { "input": { "path": "/abs/path/to/enex-folder" } }
```

Dry-run first; `run` returns a rollback-able `batchId`. Large exports stream from
disk note-by-note, so multi-GB `.enex` files don't have to fit in memory.

## What maps, and how

| Evernote                        | Fables                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| Notebook (one `.enex`)          | Notebook (named after the file).                                                              |
| Note                            | Note, with created/updated dates preserved.                                                   |
| ENML body                       | Markdown (headings, lists, quotes, code, tables, checkboxes).                                 |
| Resources (images, PDFs, files) | Attachments in the content-addressed store, matched to the body by content hash and relinked. |
| Tags                            | Fables tags (flat).                                                                           |
| Web clips                       | Converted to markdown with a "Clipped from <source>" link.                                    |
| Reminders                       | Rendered as a visible reminder line on the note.                                              |

## Honest limits (shown in the dry-run report)

- **Tag hierarchies** and **notebook stacks** aren't present in the ENEX format,
  so tags import flat and stacks can't be reconstructed.
- **Web clips** are simplified to markdown — the original page styling isn't
  preserved (flagged as lossy per note).
- **Encrypted notes** can't be read from an export; they're detected and skipped,
  with their titles listed in the skip report.
