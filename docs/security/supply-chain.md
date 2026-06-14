# Dependency Supply-Chain Policy (F1266)

Fables is local-first and ships no telemetry, so its main external attack surface
is its **dependencies**. This page states the pinning policy and how it is
enforced.

## Pinning policy

Every dependency in every `package.json` (root + all workspace packages) MUST use
a bounded, registry-pinned specifier:

- an exact version — `1.2.3`
- a caret range — `^1.2.3` (allows compatible minor/patch updates)
- a tilde range — `~1.2.3` (allows patch updates only)
- the workspace protocol — `workspace:*` (internal `@fables/*` packages)

The following are **forbidden** and rejected by an automated test:

- wildcards — `*`, `latest`, `x`
- unbounded ranges — `>=1.0.0`, `>1.0.0`
- remote specifiers — `git+https://…`, `http://…`, `file:…`

Wildcards and unbounded ranges let an unreviewed (or attacker-controlled) version
resolve into a build; remote specifiers bypass the registry's integrity checks
entirely.

## Enforcement

`packages/core/src/supply-chain.test.ts` scans every `package.json` on each test
run and fails the suite if any dependency violates the policy. It also self-checks
the matcher against known-good and known-bad specifiers, so the guard itself can't
silently rot.

The pnpm lockfile (`pnpm-lock.yaml`) pins the exact resolved version and integrity
hash of every transitive dependency; CI installs with the lockfile frozen, so the
resolved tree is reproducible and tamper-evident.

## Reviewing new dependencies

Before adding a dependency, prefer: a smaller/zero-dependency option, a
well-maintained package with a clear provenance, and a pinned range. Heavy or
optional capabilities (embeddings, OCR, generative art) are loaded behind the
graceful-degradation pattern so they are never required for the core app to run.
