# The Forge Language Specification

This document is the authoritative specification of **Forge**, the interactive-fiction
DSL used by Fables. It is derived from the implementation in
`packages/forge-dsl/src/` and describes the behavior of that compiler exactly; where
the language has rough edges, this spec documents the rough edges rather than an
idealised language. Section-by-section traceability to the implementation and its
tests lives in [conformance.md](./conformance.md).

All examples in this document compile (no error-severity diagnostics) with the
current compiler unless explicitly marked otherwise; a few deliberately produce
the warning under discussion.

---

## 1. Overview

### 1.1 Design goals

Forge is a small, line-oriented language for branching stories, in the tradition of
Ink. Its design goals, in priority order:

1. **Prose first.** A plain paragraph of text is a valid program. Markup intrudes
   only at the start of a line or inside clearly delimited inline blocks.
2. **Never crash, never stop early.** The compiler never throws on any input and
   never halts at the first error. Every phase recovers and keeps reporting, so a
   writer always gets the full list of problems (see the
   [diagnostics appendix](#15-appendix-diagnostic-catalog)).
3. **Pure core.** The compiler performs no I/O. File access for `INCLUDE` and
   knowledge-base lookups for `@entity` / `[[note]]` bindings are injected
   interfaces; without them, those features degrade gracefully.
4. **Stable surface.** Diagnostic codes are append-only and never renumbered. The
   formatter is idempotent and refuses to touch code it cannot fully parse.

### 1.2 Files

Forge source files use the `.fable` extension. Source is UTF-8 text; lines are
separated by `\n` (a preceding `\r` is ignored). A story may span multiple files
joined by [`INCLUDE`](#11-includes) directives.

### 1.3 Line orientation

Forge is line-oriented: the _kind_ of a line is decided by its first
non-whitespace characters.

| Line starts with                           | Line kind               |
| ------------------------------------------ | ----------------------- |
| `==` (two or more `=`)                     | knot header             |
| `=` (single)                               | stitch header           |
| `*` or `+`                                 | choice                  |
| `->`                                       | divert line             |
| `-` (not `->`)                             | gather                  |
| `~`                                        | logic line              |
| `VAR`, `CONST`, `INCLUDE` (as whole words) | declaration / directive |
| `//` or `/*`                               | comment                 |
| anything else                              | prose text              |

Within a line, the lexer switches between **text mode** (prose with inline `{...}`
blocks, diverts, glue, tags, bindings) and **logic mode** (identifiers, literals,
operators). Logic mode applies to `~` lines, `VAR`/`CONST` initialisers, and the
expression parts of inline `{...}` blocks.

### 1.4 Compilation pipeline

Compilation runs four phases over a shared diagnostic bag, in order:

```
tokenize  →  parse  →  resolve  →  check
 (lexer)    (parser)   (symbols)   (checker)
```

- **tokenize** — mode-aware lexing. Invalid input becomes `Error` tokens plus
  diagnostics; the lexer always terminates.
- **parse** — recursive descent into a typed AST with source spans. Error
  recovery happens at line boundaries, so one bad line never cascades.
- **resolve** — two-pass symbol resolution across all included files: first
  declare every knot, stitch, label, and variable; then resolve every reference.
  Post-passes report unused variables and unreachable knots.
- **check** — semantic checks: expression typing, boolean conditions, list
  operations, weave structure rules, choice-exhaustion analysis, tunnel pairing,
  constant reassignment, and entity-field validation.

The public entry point `compile(source, options)` returns the AST, the symbol
table, all diagnostics sorted by position, and an `ok` flag that is true when no
diagnostic has `error` severity. Warnings and hints never fail a compile.

### 1.5 Purity and injected services

The compiler is a pure function of its inputs. Two service interfaces may be
injected through `CompileOptions`:

- **`FileProvider`** — resolves `INCLUDE` paths to file contents. Without one,
  every `INCLUDE` reports `FORGE207`.
- **`KnowledgeResolver`** — validates `@entity` bindings and `[[note]]` references
  against the Fables knowledge base. Without one, binding validation is skipped
  entirely (the syntax still parses).

---

## 2. Lexical structure

### 2.1 Identifiers and keywords

Identifiers match `[A-Za-z_][A-Za-z0-9_]*` and are case-sensitive.

The directive keywords `VAR`, `CONST`, and `INCLUDE` are recognised only at the
start of a line, and only as whole words (`VARnish` begins a prose line). `temp`
is a keyword only immediately after `~` on a logic line.

In logic mode, `true` and `false` are boolean literals, and the words `and`,
`or`, `not`, `has`, `hasnt` are operators. These words therefore cannot be used
as variable names inside expressions.

### 2.2 Numbers

Number literals are decimal: an integer part, optionally followed by `.` and a
fraction (`3`, `0.5`, `12.25`). There is no leading-dot form (`.5` is a `.`
token followed by `5` and will not parse as a number). A digit run followed
directly by identifier characters is a malformed literal and reports
**FORGE004** (`12abc`).

### 2.3 Strings

Strings are double-quoted, single-line, and support the escapes `\n`, `\t`,
`\"`, and `\\`. An unrecognised escape drops the backslash (`"\q"` is `q`). A
string that reaches the end of its line without a closing quote reports
**FORGE002** and the lexer recovers at the line boundary.

```fable
VAR greeting = "Good " + "morrow"
"{greeting}," says the wolf, "stay\nback" — with a "\"grin\"".
```

### 2.4 Comments

Line comments `// ...` run to the end of the line. Block comments `/* ... */`
may span multiple lines; an unclosed block comment reports **FORGE003**.
Comments are recognised in both text and logic mode, anywhere on a line. See
[section 8.3](#83-comment-attachment) for how comments attach to the AST and
[section 8.4](#84-suppression-comments) for `// forge-ignore`.

### 2.5 Escapes in prose

In text mode, a backslash makes the next character literal prose. This is how
to write characters that would otherwise be markup: `\{`, `\[`, `\#`, `\@`,
`\->` (escaping the `-` defuses the arrow), `\<>`, and — at the start of a line —
`\*`, `\+`, `\-`, `\=`, `\~` to begin a prose line with a marker character.

```fable
The sign reads: \-> market this way \<>.
A carved \{rune\} marks the post. \# not a tag
\@nobody lives here.
```

### 2.6 Lexical error recovery

The lexer never throws and provably always makes forward progress. Any
character it cannot place becomes an `Error` token plus a diagnostic
(**FORGE001** for invalid characters), and lexing continues on the same line.

---

## 3. Story structure

A story file is, in order: optional [header tags](#81-story-header-tags),
then any mix of `INCLUDE` directives, `VAR`/`CONST` declarations, preamble
content, and knots.

### 3.1 The preamble

Content before the first knot is the **preamble**. It is the story's entry
point: execution starts there, and it typically ends with a divert into the
first knot.

```fable
The wood smelled of rain.
-> meeting

=== meeting ===
A crow sat on a branch.
-> END
```

If the preamble is empty, the story instead starts at the first knot in the
file (this matters for [dead-knot detection](#76-reachability-and-dead-knots)).

### 3.2 Knots

A knot is a named section, opened by a header line whose marker is **two or
more** `=` characters. A closing run of `=` is optional and purely cosmetic.
A knot header may carry [tags](#82-line-and-knot-tags).

```fable
-> meeting

=== meeting ===
A crow sat on a branch.
-> morning

== morning          // also a valid knot header
Sunlight crept across the moss.
-> END
```

The knot name must be an identifier; a header without one reports
**FORGE106**. Any extra non-tag content on the header line reports
**FORGE101**. A knot's body runs until the next knot header, stitch header,
`INCLUDE` directive, or end of file. Duplicate knot names (anywhere across all
included files) report **FORGE201** with the first declaration as a related
span.

### 3.3 Stitches

A stitch is a named subsection of a knot, opened by a single `=` at the start
of a line. Stitches belong to the knot above them; a stitch outside any knot
reports **FORGE109** (its content is then treated as preamble content).

```fable
=== palace ===
The lion's palace is a sun-warmed rock.
-> palace.throne

= throne
He receives visitors here.
-> kitchen

= kitchen
Bones, mostly.
-> END
```

A stitch's full address is `knot.stitch` (here `palace.throne`). Within the
same knot the bare stitch name suffices as a divert target
(see [section 7.2](#72-target-resolution)).

---

## 4. Choices, gathers, and the weave

### 4.1 Choice markers: `*` once-only, `+` sticky

A line starting with `*` offers a **once-only** choice: after the reader picks
it, it never appears again. A line starting with `+` offers a **sticky** choice
that remains available on every visit.

```fable
=== crossroads ===
The path splits beneath an old oak.
* Take the shaded trail.
  Ferns brush your ankles.
  -> crossroads
+ Sit and rest a while.
  -> crossroads
```

The content of a choice — everything indented conceptually "under" it, up to
the next choice or gather at the same or shallower depth — forms the choice's
body. Indentation itself is not significant; nesting is expressed by marker
repetition.

### 4.2 Nesting by marker repetition

Repeating the marker deepens the nesting level. Markers may be spaced or
compact: `* *` and `**` are both depth 2. The markers of a single choice must
all be the same character; in a line like `* + Go.`, only the leading `*`
counts as a marker and `+ Go.` becomes the choice's text.

```fable
=== burrow ===
The rabbit kits crowd around you.
+ Tell them a story.
  * * The one about the moon.
    They gasp at the part with the owl.
    - - They drift to sleep. -> END
  + + A story you make up on the spot.
    -> END
+ Shoo them off to bed.
  -> END
```

A choice may go at most one level deeper than the deepest currently open
choice. Skipping a level (depth 1 followed directly by depth 3) is accepted but
reports the warning **FORGE107**.

### 4.3 Bracket text: `[choice-only]` splitting

Square brackets on a choice line split its text into three parts:

- **prefix** — before `[`, shown both in the choice menu and in the output;
- **choiceOnly** — inside `[...]`, shown only in the choice menu;
- **outputOnly** — after `]`, shown only in the output once chosen.

```fable
=== riverbank ===
A salmon flashes in the shallows.
* Lunge [at the salmon] at the salmon and miss entirely.
  -> riverbank
+ Wait [patiently] with the patience of winter.
  The salmon drifts closer.
  -> END
```

At most one `[...]` group is allowed per choice; a second `[` or an unmatched
`]` reports **FORGE101**. Brackets are only special on choice lines — in plain
text lines and gathers, `[` and `]` are ordinary prose (except `[[`, which
opens a [note reference](#102-note-references) everywhere).

### 4.4 Labels

A choice or gather may be labelled by writing `(name)` **immediately after the
markers**, before any condition or text. Labels become addressable flow targets
and [read counts](#68-read-counts).

```fable
=== clearing ===
Moonlight pools in the clearing.
* (howl) Howl at the moon.
* (dig) Dig at the cold earth.
+ (wait) Do nothing at all.
- (gathered) Whatever you did, the night swallows it.
{howl > 0: Your throat is still sore.}
-> END
```

A label declared anywhere inside a knot's body (at any choice depth) has the
full address `knot.label`; one declared inside a stitch has
`knot.stitch.label`. Duplicate labels in the same container report
**FORGE201**.

Order matters: `(label)` must come before any `{condition}` group. In
`* {cond} (name) text`, the `(name)` is ordinary prose shown to the reader,
not a label — no diagnostic is issued for this.

### 4.5 Choice conditions

One or more `{expression}` groups between the marker (and optional label) and
the choice text are **conditions**; the choice is offered only when every
condition is true. Each condition must type as `bool` (**FORGE302**
otherwise).

```fable
VAR favor = 0
VAR tribute = ["honey", "figs"]

-> gates

=== gates ===
Two hyenas flank the gates.
* (bribe) {favor >= 0} {tribute has "figs"} Slip the hyenas a fig.
  -> hall
+ Turn back.
  -> END

=== hall ===
The hall smells of warm stone.
-> END
```

Condition collection stops at the first `{...}` group that is not
expression-shaped: a sequence such as `{a|b}` in that position becomes choice
text instead.

### 4.6 Gathers

A gather line starts with one or more `-` (that are not part of `->`). Spaced
(`- -`) and compact (`--`) repetition both work. A gather at depth _n_ closes
every open choice at depth ≥ _n_ and re-joins the flow: after any choice's body
finishes, execution falls through to the next gather at its level.

```fable
VAR favor = 0

-> audience

=== audience ===
"Speak," he rumbles.
* "I bring news of the river."
  ~ favor = favor + 2
* Say nothing.
- He waves a paw, satisfied or not.
Favor stands at {favor}.
-> END
```

Gathers may carry a `(label)` and tags. Note that _any_ prose line beginning
with `-` is a gather; to start a prose line with a literal dash, escape it
(`\- like so`).

### 4.7 Fallback choices

A choice with no visible text whose content is just a divert is a **fallback
choice**: it is taken automatically when no other choice remains. Both forms
below are idiomatic:

```fable
=== larder ===
The larder grows barer each visit.
* Take the last honeycomb.
  -> larder
* Take the dried fish.
  -> larder
* -> empty

=== empty ===
Nothing is left but crumbs and regret.
-> END
```

### 4.8 Weave diagnostics

- **FORGE107** (warning) — choice nesting skips a level
  ([section 4.2](#42-nesting-by-marker-repetition)).
- **FORGE305** (warning) — _choice exhaustion_: a choice point whose options are
  all once-only, with no fallback, inside a knot that can be revisited (the
  knot can reach itself through the divert graph). Eventually nothing remains
  to pick. Add a sticky `+` choice or a fallback.
- **FORGE310** (warning) — _empty choice_: a choice with no visible text
  (prefix and `[...]` part are blank) and no divert is unselectable by a
  reader. Interpolations and other dynamic segments count as visible text;
  a textless choice with a divert is a fallback and is fine.

---

## 5. Variables and types

### 5.1 Global declarations: `VAR` and `CONST`

`VAR name = expression` declares a mutable global; `CONST name = expression`
declares an immutable one. Both **must** be initialised — a declaration without
`= expression` reports **FORGE103**. Declarations are conventionally written at
the top of the file, but a `VAR`/`CONST` line anywhere inside a knot is hoisted
and is global all the same. Globals are visible everywhere, including in files
that include (or are included by) the declaring file, and may be referenced
before the declaring line (resolution is two-pass).

```fable
VAR hunger = 3
VAR name = "Reynard"
CONST den_name = "Bramble Hollow"

{name} dozes at {den_name}, hunger at {hunger}.
```

Re-declaring an existing global (in any file of the story) reports
**FORGE201** with the first declaration as a related span. Assigning to a
`CONST` reports **FORGE307**, also with the declaration site attached.
A global that is never read or assigned reports **FORGE209** (warning).

### 5.2 Temporary variables: `~ temp`

`~ temp name = expression` declares a temporary variable. Temps are scoped to
the **knot** they appear in (a temp declared in a knot's body is visible in
that knot's stitches too; temps in the preamble are scoped to the preamble),
and they are per-file. Unlike globals, temps are not hoisted: using a temp
before its declaring line reports **FORGE203**. A temp may not reuse the name
of another temp in the same scope or of any global (**FORGE201**). Unused
temps report **FORGE209**.

```fable
VAR hunger = 3

=== hunt ===
~ temp found = 2
~ hunger = hunger - found
The fox returns with {found} voles. Hunger is now {hunger}.
-> END
```

### 5.3 Types and inference

Forge has four value types:

| Type     | Literals               |
| -------- | ---------------------- |
| `bool`   | `true`, `false`        |
| `number` | `3`, `0.5`             |
| `string` | `"cheese"`             |
| `list`   | `["feather", "acorn"]` |

There are no type annotations: a variable's type is inferred from its
initialiser, in declaration order. When the initialiser's type cannot be
determined the variable is `unknown`, which silently satisfies every check.

### 5.4 Assignment

`~ name = expression` assigns to a global or temp. Assigning to an undeclared
name reports **FORGE203** (with a did-you-mean hint). Assigning a value whose
type differs from the variable's inferred type reports **FORGE301**, with one
deliberate exception: a `list` variable accepts `list`, `number`, or `string`
values, so that the idiomatic `~ bag = bag + "stone"` add/remove pattern
checks cleanly. (A consequence is that directly assigning a bare string or
number to a list variable is also accepted.)

```fable
VAR satchel = ["feather", "acorn"]

=== trade ===
~ satchel = satchel + "river stone"
~ satchel = satchel - "feather"
You carry {COUNT(satchel)} treasures.
-> END
```

### 5.5 Logic lines in general

A `~` line holds exactly one statement: a `temp` declaration, an assignment,
or a bare expression (evaluated for effect, e.g. `~ RANDOM(1, 6)` — though a
discarded pure expression is rarely useful). A divert cannot appear on a logic
line; `~ x = 1 -> camp` reports **FORGE101**.

---

## 6. Expressions

### 6.1 Operator precedence

Higher numbers bind tighter. This table is the implementation's
`BINARY_PRECEDENCE`, verbatim:

| Level | Operators                       |
| ----- | ------------------------------- |
| 1     | `\|\|` (`or`)                   |
| 2     | `&&` (`and`)                    |
| 3     | `==` `!=`                       |
| 4     | `<` `<=` `>` `>=` `has` `hasnt` |
| 5     | `+` `-`                         |
| 6     | `*` `/` `%`                     |

Unary `-` and `!` (`not`) bind tighter than every binary operator. The ternary
conditional `cond ? a : b` binds loosest of all. All binary operators are
left-associative; parentheses group as usual.

```fable
VAR cunning = 4
VAR boldness = 2
VAR is_winter = false

Score: {cunning * 2 + boldness % 3 - 1}.
Verdict: {(cunning > 3 and boldness > 1) or is_winter: ready|not ready}.
Plan: {(cunning >= boldness ? "scheme" : "charge")}.
```

### 6.2 Word operators

`and`, `or`, `not`, `has`, `hasnt` are interchangeable with `&&`, `||`, `!`,
and themselves; the formatter and printer canonicalise `and`/`or`/`not` to the
symbolic forms and keep `has`/`hasnt` as words.

### 6.3 Arithmetic and string concatenation

`+ - * / %` operate on numbers; operands of any other type report
**FORGE301**. The single overload is `string + string`, which concatenates.
There is no implicit conversion — `"a" + 1` is a type error.

### 6.4 List operations

- `list + element` produces a list with the element added.
- `list - element` produces a list with the element removed.
- `list has element` / `list hasnt element` test membership and produce `bool`.
  The left operand of `has`/`hasnt` must be a list; anything else reports
  **FORGE303**.

```fable
VAR satchel = ["feather", "acorn"]

~ satchel = satchel + "river stone"
{satchel has "acorn": The acorn is safe.|No acorn!}
~ satchel = satchel - "feather"
{satchel hasnt "feather": The feather is gone.}
```

### 6.5 Comparisons and equality

`<` `<=` `>` `>=` compare **numbers only** (FORGE301 otherwise) and produce
`bool`. `==` and `!=` require both operands to have the **same** type
(FORGE301 otherwise) and produce `bool`.

### 6.6 Boolean operators and conditions

`&&`/`||` (and `and`/`or`) require `bool` operands; `!`/`not` requires a
`bool`; unary `-` requires a `number` (all FORGE301). Everywhere the language
expects a condition — choice conditions, inline conditionals, ternary
conditions — the expression must type as `bool`, or **FORGE302** is reported
with a coercion hint (`coins` → "compare it explicitly, e.g. `x > 0`").

### 6.7 Ternary conditional

`cond ? whenTrue : whenFalse`. The condition must be `bool`; the two branches
must have the same type, or **FORGE301** ("ternary branches disagree") is
reported. See [section 9.4](#94-brace-classification) for restrictions on
ternaries inside inline `{...}` blocks.

### 6.8 Read counts

The name of a knot, stitch, or label is itself an expression of type
`number`: how many times that target has been visited. Targets are addressed
the same way as diverts — fully (`meeting.after`) or relative to the current
knot and stitch ([section 7.2](#72-target-resolution)).

```fable
=== spring ===
{spring > 1: You have been here before.|The water is new to you.}
+ Drink again.
  -> spring
* Move on.
  -> meadow

=== meadow ===
{spring} visits to the spring brought you here.
-> END
```

`END` and `DONE` are not readable as counts — they are special only as divert
targets.

### 6.9 Built-in functions

Calls use `NAME(arg, ...)`. The built-ins, with exact signatures:

| Function  | Signature                   |
| --------- | --------------------------- |
| `RANDOM`  | `(number, number) → number` |
| `FLOOR`   | `(number) → number`         |
| `CEILING` | `(number) → number`         |
| `ABS`     | `(number) → number`         |
| `MIN`     | `(number, number) → number` |
| `MAX`     | `(number, number) → number` |
| `COUNT`   | `(list) → number`           |
| `TURNS`   | `() → number`               |

Calling an unknown function reports **FORGE203** (with a did-you-mean hint);
a wrong argument count or argument type reports **FORGE301**.

```fable
VAR den_count = 3

=== divvy ===
~ temp roll = RANDOM(1, 6)
~ temp share = FLOOR(roll / den_count)
Each den gets {MAX(share, 1)} hare{ABS(share - 1) != 0: s}.
After {TURNS()} turns, the hunt ends.
-> END
```

---

## 7. Flow control

### 7.1 Diverts

`-> target` transfers flow to a knot, stitch, or label. A divert may stand on
its own line, end a text line, or end a choice line; in every case the divert
is the line's final flow action.

```fable
The fox curled up in her den.
-> morning

=== morning ===
Sunlight crept across the moss.
-> END
```

A bare `->` with no target reports **FORGE105**. A divert to a name that
exists nowhere reports **FORGE202**, with a did-you-mean hint drawn from all
targets in scope.

### 7.2 Target resolution

Divert targets (and read counts) are looked up in this order:

1. **Fully qualified** — `knot`, `knot.stitch`, `knot.label`, or
   `knot.stitch.label`, valid from anywhere in the story (across files).
2. **Knot-relative** — inside knot `k`, a bare `name` finds `k.name`
   (a stitch or label of the current knot).
3. **Stitch-relative** — inside stitch `k.s`, a bare `name` also finds
   `k.s.name` (a label of the current stitch), and `s2.name` finds a label
   in a sibling stitch via rule 2.

```fable
-> waiting

=== waiting ===
Time passes.
// fully qualified label:
-> meeting.after

=== meeting ===
+ (flatter) "What a beautiful voice!"
- (after) The forest hums.
// knot-relative, resolves to meeting.after:
-> after
```

### 7.3 `END` and `DONE`

`END` and `DONE` are reserved divert targets understood by the runtime: `END`
finishes the story, `DONE` finishes the current flow (e.g. closes a thread or
tunnel-less section). They never resolve to story content and are always
valid targets.

### 7.4 Tunnels

`-> target ->` calls a knot as a **tunnel**: flow goes to the target and comes
back when the tunnel executes a `->->` (tunnel return), resuming after the
call site.

```fable
=== day ===
The cubs want to play.
-> pounce_lesson ->
After the lesson, everyone naps.
-> END

=== pounce_lesson ===
Crouch. Wiggle. Leap!
->->
```

The checker verifies pairing per knot (**FORGE306**, warning): a knot
containing `->->` should be called as a tunnel somewhere, and every knot
called as a tunnel should contain a `->->`. (`-> END ->` is permitted and
exempt.)

### 7.5 Glue

`<>` glues output together across line breaks: text on either side of glue is
joined without an intervening newline. Glue may appear anywhere in prose.

```fable
=== intro ===
The lion yawned. <>
It was a vast yawn.
He had eaten well. <> Twice, in fact.
-> END
```

### 7.6 Reachability and dead knots

Content in the same block after an unconditional divert (or `->->`) can never
run and reports **FORGE304** (warning). A following gather re-joins flow from
nested choices, so content after a gather is reachable again. Tunnel calls
(`-> t ->`) do not terminate a block, since flow returns. Sibling _choices_
after a divert are flagged too: a `-> END` line sitting between a gather and a
later choice at the same level cuts that choice off (the fixture corpus's
`05-nested-choices.fable` records exactly this warning in its golden
snapshot).

```fable
=== way ===
You set off at dawn.
-> camp
This line can never be read.   // FORGE304

=== camp ===
The fire is warm.
-> END
```

Knot-level reachability is computed by BFS over the divert graph from the
story entry: the preamble, or the first knot when the preamble is empty.
A knot no path reaches reports **FORGE208** (warning). The graph includes
diverts from anywhere inside a knot (its stitches and choice bodies) and
tunnel calls.

---

## 8. Tags, metadata, and comments

### 8.1 Story header tags

Lines containing only `# key: value` tags at the very top of the file (before
any other content) form the **story header**. The tag text after `#` is free
form, trimmed; the `key: value` convention is just a convention. Several tags
may share one line — each `#` starts a new tag.

```fable
# title: The Council of Beasts
# author: Aesop
# version: 2

-> council

=== council ===
The beasts assemble at the stone table.
-> END
```

A tag line appearing after any non-tag content is no longer a header tag — it
becomes an ordinary (textless) tagged line in the flow.

### 8.2 Line and knot tags

A `#` in prose starts a tag that runs to the next `#`, the start of a comment,
or the end of the line. Tags may sit on text lines, choices, gathers, and knot
headers; they attach metadata to that line for the runtime (e.g. mood,
chapter, audio cues).

```fable
=== intro === # chapter: one
It was a vast yawn. # mood: sleepy
+ Walk away. # quiet ending
  -> END
```

One caveat: on a **standalone divert line**, a trailing tag (or comment) only
attaches when it follows the target with no intervening space
(`-> camp# mood: dark`); with a space, the stray whitespace becomes an
unexpected text token and the parser reports FORGE101. In practice, put
tagged diverts at the end of a text or choice line, and put comments for a
divert on the line above it. To write a literal `#` in prose, escape it:
`\#`.

### 8.3 Comment attachment

Comments are trivia, not content, but they are preserved in the AST and by the
formatter: full-line comments attach as _leading comments_ of the next
line-level node, and a comment after content on the same line attaches as that
node's _trailing comment_.

```fable
// The fable of the patient stork.
VAR patience = 10 // she has plenty

/* The shore is where
   everything happens. */
=== shore ===
The stork waits. // and waits
~ patience = patience - 1 // tick
```

Trailing comments work on text, logic, choice, and gather lines; on a
standalone divert line they hit the same space sensitivity as tags
([section 8.2](#82-line-and-knot-tags)) — comment a divert from the line
above.

### 8.4 Suppression comments

`// forge-ignore FORGE123` suppresses diagnostics with the listed code(s) on
**its own line and the line directly below**. Multiple codes may be listed;
`// forge-ignore` with no code suppresses everything on those lines.

```fable
// forge-ignore FORGE209
VAR dust = 99
```

Suppressions are honoured by every phase. Per-compile severity overrides
(promote, demote, or disable a code) are also available programmatically via
`severityConfig`.

---

## 9. Inline content

Prose lines may embed dynamic content in `{...}` blocks. A block must open and
close on the same line; an unclosed `{` reports **FORGE104**.

### 9.1 Interpolation: `{expression}`

Evaluates the expression and writes the result into the text. The expression
is type-checked; a block that holds no valid expression reports **FORGE308**.

```fable
VAR name = "Reynard"
CONST den_name = "Bramble Hollow"

~ temp found = 2
{name} returns to {den_name} with {found} voles.
```

This also works inside strings indirectly — interpolation happens at the prose
level, so `"{greeting}," says the wolf.` renders the variable, then the
literal quotes.

### 9.2 Inline conditionals: `{cond: then|else}`

A boolean expression, a colon, a _then_ branch, and optionally a pipe and an
_else_ branch. **At most two branches**: a second `|` reports FORGE101. Either
branch may be empty; `{has_key: relief}` renders nothing when false. Branches
are prose and may nest further inline blocks.

```fable
VAR has_key = true
VAR cunning = 3

The iron gate is {has_key: unlocked|sealed shut}.
You feel {has_key: relief}.
The crow {cunning > 2: suspects nothing|eyes you warily}.
```

### 9.3 Alternatives: sequence, cycle, shuffle

A block whose top level contains `|` separators is an **alternative**; each
visit to the line picks a branch:

- `{a|b|c}` — **sequence**: a, then b, then c on every visit after.
- `{&a|b|c}` — **cycle**: a, b, c, a, b, c, ...
- `{~a|b|c}` — **shuffle**: a uniformly random branch each visit.

```fable
=== watch ===
The heron {stands|still stands|has not moved}.
The reeds {&whisper|rattle|sigh}.
A frog {~plops|croaks|vanishes}.
```

### 9.4 Brace classification

The lexer decides a block's flavour by prescanning to the matching `}` on the
same line. Only characters at brace depth 1 and outside parentheses count:

1. `&` or `~` immediately after `{` → cycle / shuffle.
2. Otherwise, a `:` (seen before any `|` and before any `?`) → conditional.
3. Otherwise, a single `|` → sequence. `||` is the _or_ operator, never a
   branch separator: `{a || b}` is an interpolation.
4. Otherwise → interpolation.

Consequences worth knowing:

- A whole-block ternary works, parenthesised or not: `{x > 1 ? 1 : 2}` and
  `{(x > 1 ? 1 : 2)}` are both interpolations (the `?` stops the `:` from
  looking like a conditional).
- A ternary must **not** appear in the condition of an inline conditional.
  `{x > 1 ? true : false: yes|no}` silently classifies as a _sequence_ (the
  `?` disables colon detection, then the `|` wins), and the parenthesised form
  `{(x > 1 ? true : false): yes|no}` is a syntax error because logic lexing of
  the condition stops at the first `:` even inside parentheses. Hoist the
  ternary into a `~ temp` instead.
- Inside branches, write `\|`, `\:`, `\{`, `\}` for the literal characters.
- Nested blocks are skipped by the prescan, so `{cond: {x}|{y}}` classifies on
  the outer block's own `:` and `|` only.

### 9.5 Inline diverts and other segments

Besides text and `{...}` blocks, inline content may contain glue `<>`,
[knowledge bindings](#10-knowledge-bindings), `[[note]]` references, and a
trailing divert (`The cheese tumbles. -> drop`). A mid-line `-> target` ends
the line's flow at that point.

---

## 10. Knowledge bindings

Bindings are Forge's fusion hook into the Fables knowledge base. They parse
unconditionally; they are _validated_ only when a `KnowledgeResolver` is
injected into the compile.

### 10.1 Entity references

| Form                        | Meaning                                       |
| --------------------------- | --------------------------------------------- |
| `@entity`                   | reference an entity; renders its display text |
| `@entity.field`             | a field of the entity                         |
| `@kind(Display Name)`       | entity looked up by display name              |
| `@kind(Display Name).field` | field access on that entity                   |

```fable
=== meeting ===
@fox(Reynard the Fox) bows low.
His health sits at @fox.health today.
@crow watches from the elm.
-> END
```

The lookup key is the display name when present, otherwise the identifier.
With a resolver injected: an unknown entity reports **FORGE204** (error, with
did-you-mean from the resolver's entity names); a known entity with an unknown
field reports **FORGE309** (error, with did-you-mean from the schema's
fields). An unterminated `(` reports **FORGE108**. A lone `@` not followed by
an identifier character is plain prose.

Entity references are also expressions: `@ref` without a field has type
`string`; `@ref.field` has the type the entity schema declares for that field
(or `unknown` when no resolver is present).

### 10.2 Note references

`[[Note Title]]` references a knowledge-base note by title, anywhere in prose
(including choice lines). The title is free text up to `]]` on the same line;
a missing `]]` reports **FORGE108**. With a resolver injected, an unknown note
reports **FORGE205** — a _warning_, since notes are often written after the
story that mentions them.

```fable
You recall what the ledger said: [[The Trial of Reynard]].
```

---

## 11. Includes

`INCLUDE path.fable` pulls another file into the story. The path is the rest
of the line (trimmed; a `//` comment may follow). `INCLUDE` is a top-level
directive: it may appear among the header declarations or between knots, but a
line starting with `INCLUDE` inside a knot terminates that knot's body.

```fable
# title: The Wandering Fox

INCLUDE forest.fable
INCLUDE river.fable

VAR spirit = 2

-> forest_edge
```

_(This example is the entry file of a multi-file story; compiled alone —
without a `FileProvider` and the two sibling files — its `INCLUDE` lines
report FORGE207.)_

Files are resolved through the injected `FileProvider`, relative to the
including file. Without a provider, and for paths the provider cannot find,
**FORGE207** is reported. Includes recurse; a cycle reports **FORGE206** with
the full chain in the message. Diamond includes (the same file reached twice
acyclically) are loaded once.

All included files share **one symbol table**: knots, stitches, labels, and
globals declared in any file are visible in every other. Duplicate
declarations across files report **FORGE201** with both spans. An `INCLUDE`
with no path reports **FORGE110**.

---

## 12. Canonical formatting

`format(source)` reprints a story in canonical form via the AST printer. It is
idempotent (`format(format(x)) === format(x)`), preserves comments
([section 8.3](#83-comment-attachment)), and re-applies prose escapes so the
output re-lexes identically. **Sources with syntax errors are returned
untouched** — the formatter never destroys code it cannot fully parse.

Canonical form, in brief: `=== name ===` headers with tags after; blank lines
between header/declaration groups and between knots; choice bodies indented
two spaces per depth (configurable); spaced nesting markers (`* * `, configurable
to compact `**`); one space around binary operators; `# tag` separated by single
spaces; alternative branches printed without padding (`{a|b}`); `and`/`or`/`not`
canonicalised to `&&`/`||`/`!`. Prose is never re-wrapped — line breaks are
meaningful. Range formatting snaps the requested lines outward to whole
top-level sections (the header region and each knot) and leaves everything
else byte-identical; `checkFormatted` supports CI `--check` workflows.

---

## 13. Appendix: grammar

The grammar below reflects the implemented recursive-descent parser. Forge is
**not a pure context-free language**; the EBNF is annotated where context
takes over (notes G1–G5). Terminals are quoted; `*` `+` `?` have the usual
meanings; `\n` ends a line.

```ebnf
story        ::= header-tag-line* top-item* ;
top-item     ::= include | var-decl | knot | weave-line ;       (* weave-lines before
                                                                   the first knot form
                                                                   the preamble *)

header-tag-line ::= tag+ "\n" ;                                 (* only before any other
                                                                   content — note G1 *)

include      ::= "INCLUDE" path-text "\n" ;                     (* top level only *)
var-decl     ::= ("VAR" | "CONST") identifier "=" expression "\n" ;

knot         ::= knot-header (weave-line | var-decl)* stitch* ;
knot-header  ::= "=="+ identifier "="* tag* "\n" ;              (* "===" canonical *)
stitch       ::= "=" identifier "\n" (weave-line | var-decl)* ;

weave-line   ::= choice-line | gather-line | logic-line
               | divert-line | text-line | "\n" ;

choice-line  ::= marker+ label? condition* choice-text tag* "\n" ;
marker       ::= "*" | "+" ;                                    (* uniform per line;
                                                                   spaced or compact *)
label        ::= "(" identifier ")" ;
condition    ::= "{" expression "}" ;                           (* expression-shaped
                                                                   blocks only — G3 *)
choice-text  ::= segment* ("[" segment* "]" segment*)? ;        (* at most one [..] *)

gather-line  ::= gather-dash+ label? segment* tag* "\n" ;
gather-dash  ::= "-" ;                                          (* not followed by ">" *)

logic-line   ::= "~" statement "\n" ;
statement    ::= "temp" identifier "=" expression
               | identifier "=" expression
               | expression ;

divert-line  ::= (divert | tunnel-return) "\n" ;
divert       ::= "->" target ("->")? ;                          (* trailing -> = tunnel *)
tunnel-return::= "->->" ;
target       ::= identifier ("." identifier)* ;                 (* END, DONE special *)

text-line    ::= segment+ tag* "\n" ;
segment      ::= prose-text | inline-block | glue | divert
               | tunnel-return | entity-ref | note-ref ;
glue         ::= "<>" ;

inline-block ::= "{" expression "}"                             (* interpolation — G3 *)
               | "{" expression ":" branch ("|" branch)? "}"    (* conditional *)
               | "{" branch ("|" branch)+ "}"                   (* sequence *)
               | "{" "&" branch ("|" branch)* "}"               (* cycle *)
               | "{" "~" branch ("|" branch)* "}" ;             (* shuffle *)
branch       ::= segment* ;

entity-ref   ::= "@" identifier ("(" display-text ")")? ("." identifier)? ;
note-ref     ::= "[[" note-title "]]" ;
tag          ::= "#" tag-text ;                                 (* to next #, comment,
                                                                   or end of line *)

expression   ::= ternary ;
ternary      ::= or-expr ("?" expression ":" expression)? ;
or-expr      ::= and-expr   (("||" | "or")  and-expr)* ;        (* level 1 *)
and-expr     ::= eq-expr    (("&&" | "and") eq-expr)* ;         (* level 2 *)
eq-expr      ::= rel-expr   (("==" | "!=")  rel-expr)* ;        (* level 3 *)
rel-expr     ::= add-expr   (("<" | "<=" | ">" | ">="
                             | "has" | "hasnt") add-expr)* ;    (* level 4 *)
add-expr     ::= mul-expr   (("+" | "-") mul-expr)* ;           (* level 5 *)
mul-expr     ::= unary-expr (("*" | "/" | "%") unary-expr)* ;   (* level 6 *)
unary-expr   ::= ("-" | "!" | "not") unary-expr | primary ;
primary      ::= number | string | "true" | "false"
               | identifier "(" arg-list? ")"                   (* built-in call *)
               | identifier ("." identifier)*                   (* var or read count *)
               | entity-ref
               | "(" expression ")"
               | "[" arg-list? "]" ;                            (* list literal *)
arg-list     ::= expression ("," expression)* ;

identifier   ::= /[A-Za-z_][A-Za-z0-9_]*/ ;
number       ::= /[0-9]+("."[0-9]+)?/ ;
string       ::= /"([^"\\\n]|\\.)*"/ ;
```

**Context-sensitivity notes** — where the grammar above is honest prose, not CFG:

- **G1 — line dispatch.** A line's production is chosen by its first non-blank
  characters before tokenisation proper begins (the table in
  [section 1.3](#13-line-orientation)). `prose-text`, `path-text`, `tag-text`,
  `display-text`, and `note-title` are "everything until the next special
  thing," with backslash escapes; they cannot be described by a fixed terminal
  alphabet. Header tag lines are header tags only while no other content has
  appeared.
- **G2 — choice-text brackets.** `[` and `]` are delimiters only on choice
  lines; on every other line they are prose (`[[` excepted). Mixed markers do
  not nest: only the leading run of the _same_ marker character counts.
- **G3 — brace flavour.** Which `inline-block` production applies is decided by
  a prescan of the block's source ([section 9.4](#94-brace-classification)),
  not by grammar alternatives: `:` at depth 1 outside parens (before any `|`
  or `?`) selects the conditional; otherwise a single `|` selects the
  sequence; `||` never separates branches. Choice `condition` groups are
  exactly the inline blocks this prescan classifies as interpolations.
- **G4 — divert greediness.** After `-> target`, a following bare `->` is the
  tunnel marker only when _not_ followed by an identifier; in `-> a -> b` the
  second arrow starts a _new_ divert. Such chains are accepted as segments of a
  text line (`Go. -> a -> b`), but a line that _begins_ with a divert admits
  exactly one — `-> a -> b` at line start reports FORGE101.
- **G5 — newline sensitivity.** Strings, inline blocks, note references, and
  entity display names must close before the end of their line; block comments
  are the only token that may span lines.

---

## 14. Appendix: severities and suppression

Every diagnostic has a stable code (`FORGE` + three digits, append-only) and a
default severity. `error` fails the compile (`ok: false`); `warning` and
`hint` never do. Codes group by phase: `FORGE0xx` lexical, `FORGE1xx` syntax,
`FORGE2xx` resolution, `FORGE3xx` semantic. Any code can be suppressed per
line (`// forge-ignore FORGE209`, [section 8.4](#84-suppression-comments)) or
re-configured per compile (promoted, demoted, or disabled) via
`severityConfig`.

## 15. Appendix: diagnostic catalog

| Code     | Severity | Title                              |
| -------- | -------- | ---------------------------------- |
| FORGE001 | error    | Invalid character                  |
| FORGE002 | error    | Unterminated string literal        |
| FORGE003 | error    | Unterminated block comment         |
| FORGE004 | error    | Malformed number literal           |
| FORGE101 | error    | Unexpected token                   |
| FORGE102 | error    | Invalid expression                 |
| FORGE103 | error    | Invalid declaration                |
| FORGE104 | error    | Unterminated inline expression     |
| FORGE105 | error    | Invalid divert target              |
| FORGE106 | error    | Invalid knot or stitch header      |
| FORGE107 | warning  | Choice nesting depth skips a level |
| FORGE108 | error    | Invalid knowledge binding          |
| FORGE109 | error    | Stitch outside of knot             |
| FORGE110 | error    | Invalid INCLUDE directive          |
| FORGE201 | error    | Duplicate declaration              |
| FORGE202 | error    | Unknown divert target              |
| FORGE203 | error    | Unknown variable                   |
| FORGE204 | error    | Unknown entity                     |
| FORGE205 | warning  | Unknown note                       |
| FORGE206 | error    | Include cycle detected             |
| FORGE207 | error    | Included file not found            |
| FORGE208 | warning  | Unreachable knot                   |
| FORGE209 | warning  | Unused variable                    |
| FORGE301 | error    | Type mismatch                      |
| FORGE302 | error    | Condition must be boolean          |
| FORGE303 | error    | Invalid list operation             |
| FORGE304 | warning  | Unreachable content after divert   |
| FORGE305 | warning  | Once-only choices may exhaust      |
| FORGE306 | warning  | Unbalanced tunnel call/return      |
| FORGE307 | error    | Cannot reassign constant           |
| FORGE308 | error    | Invalid interpolation expression   |
| FORGE309 | error    | Unknown entity field               |
| FORGE310 | warning  | Empty choice                       |
