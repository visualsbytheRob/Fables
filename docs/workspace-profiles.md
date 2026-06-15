# Workspace Profiles

A profile is a **named UI state** — which panes are open, the active filters, the
theme, a focus mode, notification rules — that you can switch between and sync
across devices. The state is an opaque JSON blob the web app interprets; the
server stores, scopes and round-trips it.

## Profiles

CRUD under `/api/v1/profiles`. Each profile has a `name`, a `state` object, and
an optional `device` (which device the profile belongs to; `null` = global).

```
POST /api/v1/profiles
{ "name": "Desk", "state": { "theme": "light", "panes": ["editor", "graph"] } }
```

## Focus-mode presets (F1972, F1976)

`GET /api/v1/profiles/presets` returns ready-made focus modes:

- **Reading (evenings)** — read-only, larger type, editing chrome hidden, muted
  notifications: the phone-after-dark profile.
- **Writing mode** — a single pane, panels hidden, typewriter scrolling.
- **Review mode** — spaced repetition + inbox front and centre.

Copy a preset's `state` into a new profile to start from it.

## Defaults per device (F1978)

Mark a profile the default for its device scope with
`POST /profiles/:id/default`. At most one profile is the default per device, and
the repo keeps that invariant when you switch. `GET /profiles/default?device=…`
returns the device's default, falling back to the global default when the device
has none — so a new device still opens to something sensible.

## Export & import (F1977)

`GET /profiles/:id/export` returns a portable `{ name, state }`. Send it to
`POST /profiles/import` on another vault or device to recreate it. State is
preserved exactly, so a profile travels intact.

## Scope notes

The store, presets, per-device defaults and export/import are server-side and
shipped. Three behaviours live in the client because they act on the live UI:

- **Focus-mode enforcement (F1972)** — the server stores which features a mode
  hides; the web app does the hiding.
- **Time-based switching (F1973)** — a profile can carry a schedule in its
  state; the client flips profiles on it.
- **Palette quick-switch (F1975)** — a web command-palette entry over these
  endpoints.
