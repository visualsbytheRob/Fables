# Power Tools

A toolbox for keeping a large vault healthy. Every analysis is **read-only** —
nothing here mutates your notes — and the heavy logic is pure and unit-tested in
`power/analyze.ts`, so results are deterministic.

## Vault statistics (F1981)

```
GET /api/v1/power/stats?top=10
```

Everything measurable: total notes, words and bytes; tag count and histogram;
notebook distribution; average and median note length; orphan count; link count;
the most-linked notes; and a notes-per-month timeline.

## Duplicate finder (F1982)

```
GET /api/v1/power/duplicates?threshold=0.85
```

Groups exact duplicates (normalised content hash) and near-duplicates (shingled
Jaccard similarity at or above the threshold). Each group carries a similarity
score and a suggested merge target (the most recently updated note), ready to
feed the bulk-merge workflow.

## Broken-everything finder (F1983)

```
GET /api/v1/power/broken
```

Three kinds of rot in one report: **broken links** (wikilinks whose target title
doesn't exist), **missing attachments** (rows whose backing file is gone from the
content store), and **empty notes** (blank or whitespace-only bodies).

## Vault linter (F1984)

```
POST /api/v1/power/lint
{ "maxWords": 4000, "disabled": ["untagged-note"], "titlePattern": "^[A-Z]" }
```

Checks titles, tags, length, orphans, duplicate titles and a configurable naming
convention. Each finding has a `ruleId`, a `severity` (error/warning/info), the
offending `noteId`, a message, and an optional machine-readable fix-it (e.g.
`{ kind: 'addTag', tag: 'inbox' }`) a client can apply with one tap. Rules can be
disabled or re-graded per request.

## Storage analyzer (F1985)

```
GET /api/v1/power/storage?top=10
```

Where the space goes: total bytes split into note bodies vs attachments, a
per-notebook breakdown, the largest notes and attachments, and the share of
space the biggest items occupy.

## Scope notes

These power tools are server-side and shipped. Three remaining items are
front-end surfaces built on the same data:

- **Performance profiler (F1986)** — visualises slow queries/renders; the
  `GET /query/explain` plan (FQL v2) is the server-side input.
- **Keyboard macro recorder (F1987)** and **custom CSS injection (F1988)** —
  purely client-side conveniences in the web app.
