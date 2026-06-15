# Scripting Console

The scripting console lets you automate the vault with small JavaScript snippets
that call the same `fables.*` capability surface as plugins — and they're scoped
the same way, so a script can only touch what it declares.

## The capability surface

Scripts call capabilities as `fables.<area>.<method>(...)`. Each maps to a
required **scope** (identical to the plugin permission vocabulary):

| capability                                       | scope           |
| ------------------------------------------------ | --------------- |
| `notes.query` / `notes.get` / `notes.tags`       | `notes:read`    |
| `tags.list`                                      | `notes:read`    |
| `notes.create` / `notes.update` / `notes.delete` | `notes:write`   |
| `search.extend`                                  | `search:extend` |
| `storage.get` / `storage.set` / `storage.delete` | `storage`       |
| `http.fetch`                                     | `network`       |

`GET /api/v1/scripts/scopes` returns the full set.

## Script library (F1942)

Save, list, update and delete scripts under `/api/v1/scripts`. Each script has a
name, source, declared `scopes`, an optional `cron`, and an enabled flag. The
declared scopes are validated against the known set on save — an unknown scope
is a `422`.

## Static scope check / dry-run (F1946–F1947)

Before a script runs, the console statically analyses its source: it finds the
capabilities it calls, maps them to required scopes, and reports anything the
script uses but hasn't declared (or capabilities outside the surface). This is a
dry-run that catches an over-reaching script without executing it.

```
POST /api/v1/scripts/check
{ "source": "await fables.notes.create({});", "scopes": ["notes:read"] }
→ { "missingScopes": ["notes:write"], "ok": false, ... }
```

`GET /scripts/:id/check` runs the same analysis on a stored script.

## Example gallery (F1948)

`GET /api/v1/scripts/gallery` returns ready-to-run starters (tag untagged notes,
a word-count report, a daily digest), each declaring exactly the scopes it needs
— copy one into your library to begin.

## Scope notes

The library, scoping and static analysis are server-side and shipped. The parts
that need a live JavaScript engine or a UI are tracked separately:

- **Sandboxed execution (F1941)** and **dry-run transaction wrapper (F1946,
  execution half)** run a script through the plugin **worker sandbox** (resource
  limits, capability bridge, timeouts) — the same isolation plugins get.
- **Scheduled scripts (F1943)** carry a `cron`; the scheduler dispatches them
  the way it dispatches job handlers.
- **REPL with autocomplete (F1944)** and **result rendering (F1945)** are
  web-app surfaces over these endpoints.
