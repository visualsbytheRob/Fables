# Importing from Documents and Data

Fables imports several document and data formats through the same framework (dry-run
first, rollback-able `batchId`, provenance on every note). The importer can
auto-detect the right format when you point it at a file or folder. Each `run`
call takes `{ "input": { "path": "/abs/path" } }`.

## Word documents (`docx`)

Export or locate a Microsoft Word `.docx` file. Fables converts the document to a
single note, preserving headings, bold, italic, and lists as markdown. The
document title becomes the note title.

## HTML files (`html`)

Point Fables at a folder of `.html` files (e.g. a static site export or web
archive). Each file becomes a note; the `<title>` or first `<h1>` becomes the
note title. Links between local pages are converted to `[[wikilinks]]`, and local
images import as attachments.

## CSV (`csv`)

Point Fables at a `.csv` file. Each row becomes a note under an `Entities/<file>`
notebook. A `name` or `title` column becomes the note title; a `tags` column
becomes tags. All columns render as a **Properties** table in the note body.

## Outlines (`opml`)

Export from your outliner or feed reader as `.opml` (or `.xml`). Each top-level
outline item becomes a note; nested items render as a bullet list below it. Feed
URLs become links.

## Calendar (`ics`)

Point Fables at an `.ics` calendar file (e.g. from Google Calendar, Apple Calendar,
or Outlook). Each event becomes a note under a **Calendar** notebook, with the
event date preserved. Time, location, and description appear in the note body.

## Email (`email`)

Point Fables at a single `.eml` file, an `.mbox` file (Thunderbird/Apple Mail
export), or a folder containing `.eml` files. Each message becomes a note under an
**Email** notebook. The subject becomes the note title, the date is preserved, and
sender/recipient appear in a header block.

## Plain text (`plaintext`)

Point Fables at a `.txt` file or a folder of `.txt` files. Fables detects headings
and lists heuristically and converts them to markdown. Each file becomes a note.

## Run the import

```
POST /api/v1/import/<source>/dry-run  { "input": { "path": "/abs/path" } }
POST /api/v1/import/<source>/run      { "input": { "path": "/abs/path" } }
```

Dry-run first; `run` returns a rollback-able `batchId`. Files and folders stream
from disk, so large exports don't have to fit in memory.

## Honest limits (shown in the dry-run report)

- **Word documents** — embedded images are not imported yet; they're flagged as
  lossy in the dry-run.
- **HTML** — complex styling (layout, fonts, colors) is lost in markdown conversion;
  scripted content and forms are skipped. Flagged lossy per note.
- **CSV** — each row becomes a flat note; relational data and formulas can't be
  preserved. If you need structured queries, consider importing as plaintext or
  exporting to markdown first.
- **Email** — HTML/multipart messages are simplified to text. Complex formatting
  (styling, embedded images) is flagged lossy. SMTP headers beyond sender/date are
  omitted.

Every importer's lossy conversions appear in its dry-run report, so you always
know what you're getting before you commit.
