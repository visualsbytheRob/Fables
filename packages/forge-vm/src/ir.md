# Forge IR design (F402)

The Forge VM does not interpret the AST. The front-end (`@fables/forge-dsl`)
produces an AST; this package lowers it into a flat **IR program** that is the
single source of truth for execution, serialization (bytecode), optimization,
and tooling. Design goals, in order: deterministic execution, trivially
serializable, easy to map back to source, easy to debug by reading a dump.

## The flat container tree

A program is an array of **containers**. A container is a named, indexed list
of instructions. Containers are created for:

| Kind         | Created from                              | Name example          |
| ------------ | ----------------------------------------- | --------------------- |
| `preamble`   | content before the first knot             | `<preamble>`          |
| `knot`       | `=== knot ===`                            | `meeting`             |
| `stitch`     | `= stitch`                                | `palace.throne`       |
| `gather`     | `- (label)` weave gather points           | `clearing.gathered`   |
| `choiceBody` | a choice's selected-output + nested body  | `meeting.flatter`     |
| `choiceText` | a choice's presented text (+ tags)        | `meeting.flatter#text`|
| `eval`       | choice conditions, global initializers    | `meeting.flatter#cond`|
| `init`       | a `VAR`/`CONST` initializer               | `cunning#init`        |

Unlabeled synthetic containers get stable generated names (`meeting#g1`,
`meeting#c2`). Names are unique program-wide; diverts, visit counts, state
serialization, and save migration all key off container names, while
instructions reference containers by index.

**There is no implicit fall-through between containers.** Lowering guarantees
each flow container ends in a terminator: `DIVERT`, `DIVERT_DYN`,
`TUNNEL_RETURN`, `END_STORY`, `DONE`, `PRESENT`, or a `JUMP` backward.
`eval`/`choiceText`/`init` containers end in `RET`. The IR validation pass
(F407) enforces this.

## Instruction kinds

Instructions are `{ op, args, list? }` where operands are small integers that
index the shared **string table**, **constant pool**, **global table**, or
**container array**. The full opcode set (~50 ops) with operand signatures
lives in `ir.ts` (`OPCODES`); groups:

- **Stack & data** — `PUSH_CONST`, `POP`, arithmetic/logic/comparison
  (`ADD`…`HASNT`), `LIST_NEW`. Expressions lower to a postfix stack-op
  sequence (F404): `cunning * 2 + boldness` →
  `LOAD_GLOBAL cunning · PUSH_CONST 2 · MUL · LOAD_GLOBAL boldness · ADD`.
- **Variables** — `LOAD_GLOBAL`/`STORE_GLOBAL` (by global index),
  `LOAD_TEMP`/`STORE_TEMP` (frame temp slots), `LOAD_VISITS` (read counts),
  `LOAD_DYNAMIC` (host-injected read-only external state, by name), `TURNS`.
- **Output** — `TEXT` (literal), `PRINT` (pop + stringify, i.e.
  interpolation), `NEWLINE`, `GLUE`, `TAG`.
- **Intra-container flow** — `JUMP`, `JUMP_IF_FALSE` (absolute instruction
  index within the container; used by inline conditionals and ternaries) and
  `ALT` (sequence/cycle/shuffle alternatives: per-site id + branch offsets;
  selection state lives in VM state, shuffles draw from the seeded PRNG).
- **Inter-container flow** — `DIVERT`, `DIVERT_DYN` (divert-target-as-value),
  `TUNNEL`/`TUNNEL_RETURN` (call-stack ops, F406), `END_STORY`, `DONE`, `RET`.
- **Choices** — `CHOICE flags, cond+1, text, body` registers a pending choice
  (conditions are *not* evaluated here); `PRESENT` ends a choice group:
  evaluate conditions lazily, drop consumed once-only choices, present — or
  take the fallback when nothing is visible.
- **Instrumentation & host** — `VISIT` (increment a container's visit count;
  emitted at the top of knots/stitches/labels/choice bodies, F429),
  `ENTITY_PRINT`/`ENTITY_READ`/`NOTE_PRINT` (knowledge bindings as host
  calls), `EFFECT` (opaque host-dispatched commands), `CALL_BUILTIN` (stdlib
  registry), `CALL_HOST` (registered external functions).

## Choice points (F405)

A weave choice group lowers to consecutive `CHOICE` instructions followed by
one `PRESENT`. Each `CHOICE` references up to three containers: an optional
`eval` condition container (so conditions can be re-evaluated lazily at every
presentation), a `choiceText` container producing the menu text, and the
`choiceBody` container that starts with `VISIT self` (once-only consumption +
labeled-choice read counts), emits the output text, runs nested content, and
ends with a `DIVERT` to the group's continuation (the following gather, or the
enclosing weave's continuation).

## Addresses (F406)

A flow address is `(container, instruction index)`. `DIVERT` only ever targets
instruction 0 of a container. The tunnel call stack stores return addresses
as `(container, ip)` pairs; `TUNNEL_RETURN` pops one. Divert-targets-as-values
are constants of kind `divert` holding a container index (created with the
`TARGET("knot.stitch")` builtin or by diverting through a variable).

## Optimization (F409)

`optimize` (on by default in `compileToIr`) performs AST-level constant
folding — literals fold through unary/binary/ternary operators, `CONST`
globals with literal initializers are inlined — and dead-branch pruning:
inline conditionals/ternaries with constant conditions emit only the taken
branch. Folding is semantics-preserving: division keeps JS number semantics,
`==` folds only on equal types.

## Pipeline

```
source ──parse(forge-dsl)──▶ AST ──lower──▶ IR ──validate──▶ serialize ──▶ bytecode (Uint8Array)
                                          │                                │
                                          ├─ dumpIr() text dump (F408)     └─ deserialize ──▶ IR ──▶ VM
                                          └─ optimize (F409)
```
