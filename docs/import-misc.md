# Importing from Bear, Day One, and other apps

Fables imports several more sources through the same framework (dry-run first,
rollback-able `batchId`, provenance on every note). Each `run` call takes
`{ "input": { "path": "/abs/path" } }`.

## Bear (`bear`)

Export from Bear as **Markdown** (a folder of `.md` + assets). Fables harvests
Bear's tag syntax — `#tag`, nested `#parent/child`, and multi-word `#two words#` —
keeps `[[note links]]` as wikilinks, and imports referenced images.

## Day One (`day-one`)

Export as **JSON**; extract the `.zip` and point Fables at the folder (it contains
`Journal.json` + `photos/`). Entries become notes under a **Journal** notebook
with their creation date, and each entry's **location, weather, and starred**
state render as a small metadata footer. Photos import as attachments.

## Simplenote (`simplenote`)

Export produces `notes.json`. The first line of each note becomes its title; tags
and dates carry over. Trashed notes are skipped.

## Google Keep (`google-keep`)

Use **Google Takeout** → Keep (a folder of one `.json` per note). Labels become
tags, list items become markdown checkboxes (`- [ ]` / `- [x]`), pinned/archived
state is preserved as tags, and attachments import as files. Trashed notes are
skipped.

## Standard Notes (`standard-notes`)

Export a **decrypted** backup (the plain JSON, not the encrypted archive). Notes
import with their tags resolved from the backup's tag references. Trashed notes
are skipped.

## Joplin (`joplin`)

Export as **JEX** (a `.jex` tarball). Notebooks reconstruct from Joplin's folder
hierarchy, notes keep their created/updated times, and `:/resource` references
import as attachments.

## Any folder of markdown (`markdown`)

The catch-all for "just markdown with frontmatter". It tolerates several
frontmatter dialects: `title`; tags under `tags`/`tag`/`keywords` (YAML list **or**
comma/space string); dates under `date`/`created`/`created_at` (and
`updated`/`modified`). Subfolders become notebooks; `[[wikilinks]]` heal; local
images import as attachments.

> Every importer's lossy conversions appear in its dry-run report, so you always
> know what you're getting before you commit.
