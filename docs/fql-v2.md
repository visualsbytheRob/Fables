# FQL v2 — Aggregations, Expressions, EXPLAIN & Linting

FQL v2 is a backward-compatible superset of FQL v1. Every v1 query still parses,
compiles and runs exactly as before; v2 adds a post-processing layer (computed
fields + aggregations), parameterized queries, a static EXPLAIN, and a linter.

## Migration notes (v1 → v2)

Nothing breaks. The v1 grammar (`tag:`, `notebook:`, `title:`, `body:`, `has:`,
`linksto:`, `pinned:`, `created:`/`updated:`, `AND`/`OR`/`NOT`, `sort:`) is
unchanged. v2 features are opt-in through new endpoints — your existing
`GET /query` and saved queries are untouched.

## Query variables (F1964)

A query may reference `$name` placeholders, filled at run time. This is how a
saved query becomes a reusable, parameterized report.

```
notebook:$nb updated:>$days d
```

Substitution is textual and happens _before_ parsing, so values still flow
through the parameterized SQL layer — they never reach the SQL text directly. A
value containing whitespace is auto-quoted so it stays a single term. Unset
variables are left verbatim and reported back as `warnings`.

## Computed fields & expressions (F1963)

Each result note is flattened into a row with these fields you can compute over:

| field                          | meaning                      |
| ------------------------------ | ---------------------------- |
| `id`, `title`, `notebookId`    | identity                     |
| `notebook`                     | notebook **name** (joined)   |
| `pinned`                       | 1 / 0                        |
| `words`, `chars`               | body word + character counts |
| `tagCount`                     | number of tags (joined)      |
| `createdAt`, `updatedAt`       | ISO timestamps               |
| `createdMonth`, `updatedMonth` | `YYYY-MM` buckets            |

The expression language supports arithmetic (`+ - * / %`), string concatenation
(`+`), comparisons (`> < >= <= == !=`, returning a boolean), parentheses, and
functions: `len`, `lower`, `upper`, `abs`, `round(x[, digits])`,
`coalesce(...)`, `concat(...)`, `if(cond, a, b)`. Identifiers resolve only to the
row's own fields — an expression can never reach outside its data. Missing fields
are `null`; division by zero is `0`; nothing throws at evaluation time.

```json
{ "as": "readingMinutes", "expr": "round(words / 200, 1)" }
```

## Aggregations (F1961)

`POST /query/aggregate` runs a query, enriches the rows, applies any computed
columns, then groups and reduces. Metrics: `count`, `sum`, `avg`, `min`, `max`.

```json
{
  "q": "tag:meeting updated:>30d",
  "groupBy": "notebook",
  "computed": [{ "as": "readingMinutes", "expr": "round(words / 200, 1)" }],
  "metrics": [
    { "fn": "count", "as": "notes" },
    { "fn": "sum", "field": "readingMinutes", "as": "minutesToReview" }
  ]
}
```

Response: `groups` (one per distinct group key, stably sorted), each with `rows`
and the reduced `values`, plus a grand `total` across every row, the `scanned`
count, and `warnings`. Aggregation is in-memory and capped at
`AGGREGATE_ROW_LIMIT` (5,000) rows.

> Joins across types (F1962): the aggregation row is already _joined_ with its
> notebook name and tag count. Richer cross-type joins (e.g. a note's linked
> entity fields) enrich the same row shape before aggregation — the mechanism is
> the enrichment pass in `services/query-v2.ts`.

## EXPLAIN (F1965)

`GET /query/explain?q=...` returns a **static** plan — no rows fetched. It walks
the AST the compiler would lower and reports, per clause, the access method
(`scan` / `index` / `range`) and a heuristic cost, plus the indexes the query
leans on, the parameterized SQL, and warnings for shapes that can't use an index
(a leading-wildcard `LIKE` from a bare text term, for instance).

## Linting (F1968)

`POST /query/lint` returns findings ordered error → warning → info, each with a
`message`, optional `position`, and an optional `suggestion`:

- **error** — syntax errors (with offset) and unknown fields (with a
  nearest-match suggestion: `tg:` → "did you mean `tag:`?").
- **warning** — lowercase `and`/`or`/`not` (treated as search terms), and
  single-character terms that match almost everything.
- **info** — empty query, and `tag:#x` (the `#` isn't needed).

## Cookbook (F1970)

**Notes per notebook this quarter**

```json
{ "q": "updated:>90d", "groupBy": "notebook", "metrics": [{ "fn": "count", "as": "n" }] }
```

**Average length of meeting notes**

```json
{ "q": "tag:meeting", "metrics": [{ "fn": "avg", "field": "words", "as": "avgWords" }] }
```

**Writing throughput by month**

```json
{
  "q": "notebook:Drafts",
  "groupBy": "updatedMonth",
  "metrics": [{ "fn": "sum", "field": "words", "as": "words" }]
}
```

**A reusable, parameterized report** — save `notebook:$nb tag:$tag` and supply
`{ "nb": "Work", "tag": "open" }` at run time.

**Flagging long notes** — `if(words > 2000, 1, 0)` as a computed column, summed,
tells you how many notes need splitting.
