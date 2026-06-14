# Exporting from Fables

Fables exports your notes to multiple formats — each optimized for a different use case. Start with **JSON for backups and round-tripping** (lossless fidelity), or pick a format tailored to where your notes go next: Obsidian, Notion, Logseq, a static site, or a printable PDF book.

All exports are **query-scoped**: you can export everything, one notebook, or use Fables Query Language (FQL) to pick notes by tag, date, or title. Exports are written to a server-local directory or returned as a `.zip` for download.

## Using the export API

```
GET  /api/v1/export/targets                    # list available export formats
POST /api/v1/export/<target>   { query, notebookId, format }
```

Request body fields:

- **`query`** (optional): FQL filter — e.g. `tag:travel`, `created:>2024-01-01`, `title~"project"`. Omit to include all notes.
- **`notebookId`** (optional): export only notes in this notebook. Omit to include all.
- **`format`** (optional): `"dir"` (default) writes to the server's export directory; `"zip"` returns a downloadable `.zip` file.

## Export formats

| Format          | Best for                                  | Output                                                                                                         |
| --------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **json**        | Backups, round-tripping, highest fidelity | Single `fables-export.json` with the `fables-export/v1` schema, plus attachment binaries                       |
| **obsidian**    | Obsidian vault migration                  | Markdown files (one per note) under notebook folders, YAML frontmatter, `[[wikilinks]]`, `attachments/` folder |
| **notion-md**   | Notion re-import, database-style          | Markdown files under notebook folders plus `index.csv` table for properties and tags                           |
| **logseq**      | Logseq graph migration                    | `pages/` and `journals/` markdown with body as bullet-list outliner, `tags::` lines                            |
| **static-site** | Browser browsing, web hosting             | Self-contained `index.html` + one HTML file per note + `style.css`, no server needed                           |
| **pdf-book**    | Printing, sharing as a bound document     | Print-ready HTML (title page, TOC, one chapter per notebook) — open in browser and print to PDF                |

## JSON (the reference format)

```
POST /api/v1/export/json  { "query": "tag:travel", "format": "zip" }
```

The JSON export is **lossless and fully round-trippable**: export to JSON, re-import it, and you get the same notes with no data loss. The schema is documented as `fables-export/v1` and includes every field: titles, bodies, tags, dates, notebook hierarchy, attachment metadata and binaries, and all internal wikilinks.

Use this for:

- **Backups**: a complete snapshot you can restore at any time.
- **Round-tripping**: export from Fables, manipulate in another tool, re-import with full fidelity.
- **Programmatic access**: every field is structured and queryable.

## Obsidian

```
POST /api/v1/export/obsidian  { "notebookId": "personal" }
```

Generates an Obsidian-ready vault: one markdown file per note, organized under notebook folders, with YAML frontmatter for tags and dates. `[[wikilinks]]` are preserved; `![[image]]` links are rewritten to point to the `attachments/` folder. Drop the folder into Obsidian and open it as a vault.

**Honest limits:**

- Obsidian's frontmatter is YAML; Fables renders dates and tags in standard format. Custom frontmatter fields don't import from Fables.
- Some Obsidian plugins (like daily notes, templates) require specific folder and file structures that Fables doesn't impose.

## Notion

```
POST /api/v1/export/notion-md  { "query": "tag:work" }
```

Exports markdown files (one per note, under notebook folders) plus a `index.csv` table with titles, tags, dates, and notebook paths. Re-import the folder into Notion and use the CSV to reconstruct database properties.

**Honest limits:**

- Notion databases require manual setup; the CSV gives you the data, but you map columns yourself.
- Nested relations and database rollups from Notion are flattened to plain text on export, so re-import won't fully reconstruct the schema.

## Logseq

```
POST /api/v1/export/logseq  {}
```

Generates a Logseq graph with `pages/` (one `.md` per note) and optional `journals/` (daily notes with timestamps). Note bodies are formatted as an outliner bullet list; tags are rendered as `tags:: [[tag1]] [[tag2]]` lines. Fables preserves your wikilinks so navigation works out of the box.

**Honest limits:**

- Logseq's outline structure is implicit (indentation = nesting); Fables notes are flat, so deep outline hierarchies don't export as-is.
- Logseq properties (page attributes) are custom; Fables renders tags and dates only.

## Static site

```
POST /api/v1/export/static-site  { "format": "zip" }
```

A self-contained, read-only HTML vault: `index.html` (home page + search), one `.html` file per note, and `style.css`. No server, no JavaScript runtime. Open `index.html` in any browser or host the folder on GitHub Pages, Netlify, or a static server.

**Honest limits:**

- It's **read-only**; there's no back-link graph or transclusion, just static pages and links.
- Large exports (thousands of notes) generate a large `.zip`; consider narrowing the export with an FQL query.

## PDF book

```
POST /api/v1/export/pdf-book  { "query": "notebook:memoir" }
```

A **print-ready HTML document** (not a binary PDF): title page, table of contents, one chapter per notebook, one section per note. Open the HTML in your browser, style it if you like, and print to PDF. This is your best option if you want a bound, shareable archive.

**Honest limits:**

- Fables doesn't run a server-side PDF renderer; you print the HTML yourself. This keeps the server lightweight and gives you full control over margins, fonts, and color depth.
- Very large exports (thousands of notes) create long HTML files; your browser may slow down. Consider exporting per-notebook if needed.

## Lossless round-tripping

The **JSON export is fully round-trippable**: export to JSON, re-import the same file via `POST /api/v1/import/json`, and all notes, tags, dates, notebooks, attachments, and wikilinks are preserved exactly. An automated **fidelity test** guards this guarantee in every release.

Other formats are designed for specific tools and make intentional trade-offs (Obsidian frontmatter is YAML, Notion databases are schemas, Logseq is outline-based). JSON is your guarantee of no data loss.

## Query scoping

Any export accepts an optional **FQL query** to narrow the selection:

```
POST /api/v1/export/obsidian  { "query": "tag:travel created:>2024-01-01" }
```

This exports only notes tagged `travel` created after January 1, 2024. Omit `query` to export all notes. See the FQL reference for the full syntax.

> Always **export to JSON first** if you're unsure what you're getting — it's lossless and lets you inspect the exact data before re-exporting to another format.
