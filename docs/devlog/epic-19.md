# Epic 19 — Story Interop & Distribution

Making fables portable: package a story into a verifiable `.fablepack`, bring
stories in from Ink and Twine, version and release them, gather reader feedback,
generate art, and preserve everything in archives — F1801–F1900. Inspired by
Remotion (programmatic media) and the Internet Archive's preservation ethos (see
`docs/credits.md`).

## What shipped (server-side)

### .fablepack Format (F1801–F1810)

A **deterministic** ZIP container (sorted entries, zero timestamps → byte-identical
output) bundling story source, casting, assets, and a manifest with capability
requirements, version-compat ranges, content warnings, a **sha256 hash tree**, and
optional **HMAC signing**. `validatePack` recomputes the tree and rejects
undeclared entries. `docs/fablepack-spec.md`.

### Ink + Twine Compatibility (F1821–F1840)

Pure converters (`import/ink`, `import/twine`) that turn Ink common-subset and
Twee 3 source into **guaranteed-compilable Forge**, dropping and itemizing the
constructs that don't map (VAR/LIST/macros). Every test compiles its output
through the real Forge compiler — 72 tests.

### Versioning & Releases (F1841–F1850)

Release diffing (`stories/release-diff.ts`): structural + knot-level diff,
markdown changelog, save-compatibility (removed-knot detection), and rollback to
a prior release snapshot.

### Reader Feedback Loop (F1851–F1860)

Per-moment feedback notes + a local play-event log (migration 038), with choice
statistics, per-knot drop-off, and ending distribution; export/import feedback
bundles with anonymization. All local.

### Generative Art — ComfyUI Adapter (F1861–F1870)

A graceful `ArtRuntime` + `ComfyAdapter` (local + consent-gated cloud, injectable
fetch), cover/portrait/scene prompt builders + style presets, a **deterministic
typographic SVG cover fallback** when no backend is present, and a
content-addressed asset pipeline with provenance (migration 039).

### Story Archives (F1881–F1890)

A `.fablearchive` deterministic format bundling packs + a sha256 **fixity
manifest**, with verification and a preservation checklist (is everything pinned
to play "forever"?). Built on `.fablepack`.

### Distribution Close (F1891–F1900)

A full pipeline e2e (Ink import → pack → archive → verify → unpack → recompile),
a security property test, a large-pack benchmark, an interop conformance endpoint,
the user guide (`docs/distribution/guide.md`), and this retro.

## Security: packs are data, not code (F1893)

A `.fablepack` carries **story source**, which compiles to the sandboxed Fable
Forge VM (effects allowlist, no `eval`, no host access). Unpacking validates the
hash tree before trusting any entry and returns source **byte-for-byte** — there
is no code path that executes pack contents. The pipeline test packs a story full
of `alert()`, `process.exit()`, `rm -rf` text and asserts it round-trips inert.
The deterministic format means a pack's hash is its identity, so tampering is
detectable.

## A note on scope (web + network deferrals)

The standalone single-file HTML player (F1811–F1820), vault-to-vault sharing over
Tailscale (F1871–F1880), and the various browser/dashboard UIs are the web/network
layer; the server ships the formats, converters, diffs, feedback aggregation, art
pipeline, and archives they build on — all tested. Reverse exporters (Forge → Ink
/ Twee), the compiled-Ink-JSON runtime, real shared-deck corpora, and a full
format-migration framework are queued.

## Community format RFC (F1898)

The `.fablepack` and `.fablearchive` formats are documented openly
(`docs/fablepack-spec.md`) and deliberately simple — ZIP + JSON manifest + sha256
hash tree — so other tools can read and write them without our code. We invite
other interactive-fiction tools to adopt or critique the format; the determinism
and fixity guarantees are designed to make packs a durable, tool-agnostic
distribution unit.

## Migrations

038 (reader feedback + play events), 039 (generated assets). Numbered,
append-only, listed in `db.test.ts`.

## Tests

~3,450 green at the Epic-19 checkpoint, including the format determinism/tamper/
signing suites, the Ink/Twine compile-conformance suites (72), the release-diff,
feedback-aggregation, art (mocked ComfyUI), and archive-fixity suites, plus the
end-to-end distribution pipeline test.
