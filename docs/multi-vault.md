# Multi-Vault

Fables supports more than one **vault** — an independent, on-disk knowledge base
with its own data dir, notebooks, settings and encryption state. A vault is the
unit of isolation: notes in one vault never bleed into another. This is how you
keep _Work_, _Personal_ and _Worldbuilding_ materials apart while running a
single Fables server.

## The registry

The set of vaults is tracked in a small **registry** (migration `042-vaults`)
held in the primary database. Each entry records:

| field         | meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| `name`/`slug` | display name and its derived, unique URL slug                       |
| `dataDir`     | the on-disk directory backing the vault (`<dataDir>/vaults/<slug>`) |
| `template`    | the preset it was created from (F1906)                              |
| `settings`    | per-vault, isolated settings blob (F1903)                           |
| `encryption`  | this vault's own state: `none`, `locked`, `unlocked` (F1907)        |
| `federated`   | opted in to cross-vault search (F1904)                              |
| `archived`    | moved to cold storage, hidden from the default list (F1908)         |
| `active`      | exactly one vault is active at a time                               |

Exactly one vault is **active**. A partial unique index (`is_active = 1`)
enforces the invariant at the storage layer, and `setActive` flips it inside a
transaction so a switch is atomic.

## API

All routes are under `/api/v1/vaults`:

| method + path                 | purpose                                           |
| ----------------------------- | ------------------------------------------------- |
| `GET /vaults`                 | list vaults (`?archived=1` includes cold storage) |
| `POST /vaults`                | register a named vault from a template            |
| `GET /vaults/templates`       | the starter-template gallery                      |
| `GET /vaults/active`          | the currently active vault                        |
| `GET /vaults/federated`       | vaults opted in to cross-vault search             |
| `GET /vaults/:id`             | fetch one                                         |
| `PUT /vaults/:id`             | rename / move / toggle federation                 |
| `DELETE /vaults/:id`          | remove from the registry                          |
| `POST /vaults/:id/activate`   | make this the active vault                        |
| `PUT /vaults/:id/settings`    | replace isolated settings                         |
| `PATCH /vaults/:id/settings`  | merge into isolated settings                      |
| `POST /vaults/:id/encryption` | set tracked encryption state                      |
| `POST /vaults/:id/archive`    | move to cold storage                              |
| `POST /vaults/:id/unarchive`  | restore from cold storage                         |

### Invariants

- The **active** vault cannot be archived or removed.
- The **last** vault cannot be removed — there is always somewhere to write.
- Slugs are unique; registering `Dupe Vault` then `dupe vault` is a `409`.

## Templates

Templates (`vaults/templates.ts`) seed default settings and starter notebooks:

- **Blank** — an empty vault with sensible defaults.
- **Work** — Meetings / Projects / Reference, daily digest on.
- **Personal** — Journal-first, encryption on by default.
- **Worldbuilding** — Lore / Characters / Locations, Forge enabled.

## Scope notes

The registry, settings isolation, encryption-state tracking, templates and
cold-storage flags are server-side and shipped here. Two related features need
machinery beyond a single database connection and are tracked separately:

- **Switcher UI (F1902)** — the registry and `activate` endpoint ship; the
  fast-switch front-end lives in the web app.
- **Cross-vault search (F1904)** and **move/copy between vaults (F1905)** —
  these require opening several vault databases at once and orchestrating reads
  and writes across them. The `federated` flag marks which vaults opt in; the
  multi-connection query/move layer is future work.
