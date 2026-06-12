# Day 4 — The Forge Compiler (F311–F400, spec + editor integration pending)

**Shipped:** the front half of the Forge storytelling language as a zero-dependency package,
`@fables/forge-dsl` — 392 tests of compiler.

## What exists now

- **Lexer (F311–F320):** span-tracked tokens, text/logic mode switching, all structural markers
  (knots/stitches/choices/diverts/glue/tags), strings with escapes, knowledge bindings,
  error-token recovery, seeded fuzz harness (random bytes never crash), golden token snapshots.
- **Parser (F321–F330):** recursive descent → typed AST; knots/stitches/content, nested choices
  with conditions/labels/[bracket] syntax, precedence-climbing expressions, logic lines,
  diverts/tunnels/END, inline conditionals + sequences/cycles/shuffles, binding nodes,
  sync-point error recovery, golden AST snapshots.
- **AST infrastructure (F331–F340):** discriminated unions, walker, canonical printer,
  span→excerpt utilities, query helpers, parent pointers, stable serialization, node factories,
  invariant checker, printer/parser round-trips.
- **Diagnostics (F341–F350):** stable FORGE0xx catalog, pretty terminal frames with caret
  underlines, JSON mode, multi-error collection, unreachable/unused warnings, did-you-mean
  suggestions, `// forge-ignore` suppression, severity config, per-code snapshots.
- **Symbols & semantics (F351–F370):** two-pass resolution, scopes, cross-file diverts via
  injected file provider, duplicate/undefined errors with both spans, knowledge-binding
  resolver interface (server wires the real one later), include cycles, dead knots; type
  checking (bool/number/string/list), boolean-only conditions, list ops, structure rules,
  once-only exhaustion analysis, tunnel pairing, const reassignment, entity-field checks.
- **Formatter (F371–F377, F379–F380):** canonical formatting with idempotency property tests,
  comment preservation, range mode, check mode, config.
- **Test infrastructure (F391–F396, F399):** 20+ fixture fables (fox/crow/lion corpus),
  golden runner, error corpus, round-trip property tests, grammar-aware fuzzer, 10k-line
  performance benchmark, top-level `compile(source, options)` API.

## Left for the next lane (unchecked)

- F301–F310: `docs/forge/spec.md` — the agent built the language before documenting it; the
  spec must now be written FROM the implementation (with EBNF appendix), plus F398 conformance.
- F378 format-on-save + F381–F390 editor integration (CodeMirror language package, live
  diagnostics, completion, go-to-definition, outline, rename, folding) — apps/web work.
- F397 coverage gate (coverage looked healthy but the ≥90% threshold wasn't formally wired).

**Suite at close: 814 tests across the repo, all green.**
