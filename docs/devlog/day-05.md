# Day 5 — The Forge VM (F401–F500, integration halves pending)

**Shipped:** `@fables/forge-vm` — the bytecode virtual machine that plays compiled stories.
171 package tests; repo total 1,053, all green.

## What exists now

- **IR (F401–F410):** AST→IR lowering, stack-op expressions, choice points, divert/tunnel
  addresses, validation pass, text dump, constant folding + dead-branch pruning (ir.md spec).
- **Bytecode (F411–F420):** documented binary container (header/version/string table/checksum),
  ~40 opcodes, serializer/deserializer, source-map + binding-table sections, disassembler,
  serialize→deserialize→identical-execution round-trips (bytecode.md spec).
- **Codegen (F421–F430):** text/interpolation, variables + temps, full expression ops,
  sequences/cycles/shuffles, once-only visit tracking, lists, entity bindings as host calls,
  golden disassembly snapshots.
- **VM core (F431–F440):** fetch/decode/execute, glue-resolving output buffer, Continue()/
  choices()/choose() API, tunnel call stack with depth limits, source-mapped runtime errors,
  step budget against infinite loops, fixture stories driven end-to-end.
- **State (F441–F470):** typed globals/temps, visited() counts, external state injection,
  variable observers, list semantics, turn counter + choice history, full state JSON
  round-trips (property-tested: serialize mid-story → resume → identical transcript), save
  slots with metadata, rewind/time-travel, restore-compat reports, transcript export,
  corrupt-save detection; once-only/sticky/fallback choices, gathers, deep nesting,
  [bracket] splits, labels in conditions, divert-targets-as-values, torture tests.
- **Randomness & effects (F471–F490):** seeded PRNG in state, RANDOM + dice (3d6+2), shuffles,
  math/string/list stdlib (stdlib.md generated reference), deterministic-replay property
  tests, host function registry with allowlist sandboxing, async suspend/resume, effect audit
  log, story-visible error values (never crashes), mock-host integration tests.
- **Debugger & tooling (F491–F498):** step/step-over, breakpoints, watch expressions,
  time-travel, state inspector structure, runStory() scripted-test harness.

## Recovery notes

The lane was cut off at a usage reset before self-review. Found and fixed on merge: two test
scripts contradicted their own fixtures (a scripted choice index past a consumed once-only
choice; a visit-count assertion disproved by the test's own transcript expectation — the VM's
restore was exact, the test was wrong), two type errors, five lint errors. The VM itself
needed zero fixes.

## Left for the next lanes (unchecked)

F462–F463 save/autosave HTTP endpoints, F467–F468 save-slot UI + sync wiring, F480 dice UI,
F494–F496 debugger UI panels (495/496 library parts exist), F497 terminal CLI play, F499 VM
performance benchmark.

**The pipeline is real: write .fable → compile → play, all in tested code.**
