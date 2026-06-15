# Bulk Operations

Reshape many notes at once — safely. Every bulk operation follows the same
**preview → confirm → apply** flow, and every applied operation is **journalled
and reversible**. The transformation logic is pure and unit-tested in
`bulk/engine.ts`; this layer binds it to the live vault inside one transaction.

## The flow

1. **Preview** (`POST /bulk/preview`) computes the plan — a per-note before/after
   diff, counts, and a summary — and writes **nothing**.
2. **Apply** (`POST /bulk/apply`) runs the same plan, persists it in a single
   transaction, and returns a `journalId`.
3. **Undo** (`POST /bulk/:id/undo`) reverses it from the stored before-snapshot.

Both `preview` and `apply` take `{ op, scope }`.

### Scope

What the operation runs against (first match wins):

```json
{ "noteIds": ["note_a", "note_b"] }   // explicit set
{ "query": "tag:inbox" }              // an FQL query
{ "notebookId": "nb_..." }            // a whole notebook
{}                                     // the entire vault
```

## Operations

| op               | shape                                                                       | feature |
| ---------------- | --------------------------------------------------------------------------- | ------- |
| `findAndReplace` | `{ options: { find, replace, mode?, caseSensitive?, wholeWord?, scope? } }` | F1952   |
| `fieldEdit`      | `{ edits: [{ key, value? }] }` (set or clear frontmatter fields)            | F1953   |
| `wikilinkRename` | `{ renames: [{ oldTitle, newTitle }] }` (restructure-safe)                  | F1954   |
| `tagOp`          | `{ op: { action: 'add'\|'remove'\|'rename', ... } }`                        | F1955   |
| `merge`          | `{ targetId, sourceIds, separator? }`                                       | F1956   |
| `split`          | `{ noteId, headingLevel? }` (one note → many by heading)                    | F1957   |

`findAndReplace` supports literal and regex modes; an invalid regex is reported
in the plan summary rather than throwing, so a preview never half-applies.
`wikilinkRename` rewrites `[[links]]` without partially matching longer titles.

## The operation journal (F1958)

Every applied operation is recorded in `bulk_journal` with a full before-snapshot
of each touched note and the ids it created. `GET /bulk/history` lists them;
`POST /bulk/:id/undo` reverses one:

- changed notes are restored to their snapshot,
- notes the op created (a split's new sections) are removed,
- notes the op deleted (a merge's sources) are recreated from the snapshot.

Undo is idempotent-guarded: a second undo of the same entry is a `422`.
