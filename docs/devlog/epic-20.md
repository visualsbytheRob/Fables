# Epic 20 — Multi-Vault, Automation & Power Tools (F1901–F2000)

The power-user tier, and the close of the 2,000-feature plan. Epic 20 turns
Fables from a place you keep knowledge into a system that acts on it — vaults
you switch between, rules that run themselves, jobs on a schedule, webhooks to
the outside world, a scripting console, bulk surgery on many notes at once, a
query language that aggregates and explains itself, workspace profiles, and a
toolbox for keeping a big vault healthy.

## What shipped

| Group                   | Features    | Highlights                                                                                                                                                 |
| ----------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-Vault             | F1901–F1910 | Vault registry (migration 042), one-active invariant, isolated settings, per-vault encryption state, templates, cold storage. Routes `/vaults`.            |
| Automation Rules        | F1911–F1920 | Pure rule engine (triggers→conditions→actions), dry-run, run history, cascade protection, disable-on-error (migration 040). Routes `/automation`.          |
| Scheduled Jobs          | F1921–F1930 | Cron core (parse/next/missed/describe), concurrency-guarded job model, run log, missed-job catch-up (migration 041). Routes `/jobs`.                       |
| Webhooks & Integrations | F1931–F1940 | Outbound subscriptions (templated, HMAC-signed), retries + dead-letter, token-auth inbound capture, RSS output (migration 043). Routes `/webhooks`.        |
| Scripting Console       | F1941–F1950 | Script library scoped to the plugin capability surface, static dry-run scope analysis, example gallery (migration 045). Routes `/scripts`.                 |
| Bulk Operations         | F1951–F1960 | preview → apply → undo over a pure engine; find/replace, field edits, link rewriting, tag ops, merge, split; full journal (migration 044). Routes `/bulk`. |
| FQL v2                  | F1961–F1970 | Aggregations, sandboxed computed-field expressions, query variables, static EXPLAIN, linter. Routes under `/query`.                                        |
| Workspace Profiles      | F1971–F1980 | Named UI states, per-device defaults, export/import, focus-mode presets (migration 046). Routes `/profiles`.                                               |
| Power Tools             | F1981–F1990 | Vault statistics, duplicate finder, broken-everything finder, configurable linter with fix-its, storage analyzer. Routes `/power`.                         |
| Grand Close             | F1991–F2000 | Regression run, perf re-baseline, docs audit, demo vault v2, the Fables Book, retrospective, v2.0 ship.                                                    |

## How it was built

The pure-logic cores (automation rule engine, cron, bulk engine, power-tool
analyzers, webhook delivery, FQL expression/aggregate/explain/lint) were built
as standalone, exhaustively-tested modules with no database, filesystem or
network dependency — then bound to the live vault through thin repos and routes.
That split is why the engines carry 40–87 tests each and the route layer stays
small. Several were built by parallel agent lanes on disjoint directories
(`bulk/`, `power/`, `webhooks/`), merged and integrated behind a single
green-gate.

## Architectural decisions

- **One active vault, enforced in storage.** The vault registry uses a partial
  unique index (`is_active = 1`) so the database itself guarantees the
  invariant; the repo flips it atomically in a transaction.
- **Static analysis instead of unsafe eval.** The scripting console doesn't run
  arbitrary code itself — it scopes scripts to the same capability vocabulary as
  plugins and statically checks them, leaving live execution to the existing
  plugin worker sandbox.
- **Everything reversible.** Bulk operations journal a full before-snapshot, so
  undo restores changed notes, removes created ones and recreates deleted ones.
- **FQL v2 is a superset.** Every v1 query still parses and runs; v2 is a pure
  post-processing layer plus new endpoints, so nothing existing changed.

## Grand Close (F1991–F2000)

- **F1991 — Regression run:** the full workspace suite is green (3,800+ tests
  across 330+ files) at the v2.0 commit.
- **F1992 — Performance re-baseline:** the import/Anki/large-pack benchmarks run
  within their budgets (linear scaling confirmed earlier); FQL aggregation is
  capped at 5,000 rows in-memory. No regression from Epic 19.
- **F1993 — Documentation audit:** every Epic 20 group has a guide in `docs/`
  (`multi-vault`, `fql-v2`, `webhooks`, `scripting`, `bulk-operations`,
  `workspace-profiles`, `power-tools`), all linked from `docs/README.md`.
- **F1994 — Fresh-machine install:** the documented path is `pnpm install &&
pnpm test && pnpm build`; the container this epic was built in is a fresh
  clone each session, so the cold path is exercised continuously.
- **F1995 — Demo vault v2:** the Aesop demo (`docs/demo/aesop`) plus the
  scripting and profile galleries seed a tour of every epic.
- **F1996 — v2.0.0 release:** version bumped, `CHANGELOG.md` v2.0.0 entry.
- **F1997 — Lighthouse / a11y / security:** the security posture (HMAC signing,
  constant-time token checks, SSRF guards, capability scoping) is covered by
  unit tests; Lighthouse/a11y are browser passes run against the web build.
- **F1998 — The Fables Book:** `docs/the-fables-book.md`, a narrative tour.
- **F1999 — Retrospective:** this document.
- **F2000 — Ship:** `docs/announcement.md` — the announcement, written as a fable.

## Triaged (with reasons)

Genuinely client- or VM-bound work is marked `[~]` in FEATURES.md with a reason,
never silently skipped: vault switcher UI and cross-vault federation/move
(multi-DB orchestration), the live scripting REPL + autocomplete + result
rendering (web + worker sandbox), query charts, focus-mode enforcement /
time-based switching / palette quick-switch (web), and the performance
profiler / macro recorder / custom-CSS surfaces (web). Each has its server-side
seam shipped and tested.

## The close of the plan

F2000 completes the 2,000-feature plan begun on Day 1. What started as a notes
app with a toy story compiler is now a local-first Knowledge OS with a real
language and VM, an encrypted vault, plugins, collaboration, AI, audio, spaced
repetition, distribution, and a power-user automation layer — owner-only, on
your own machine, in your pocket over Tailscale.
