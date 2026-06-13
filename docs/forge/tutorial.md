# The Forge Tutorial: Zero to Your First Story in 10 Steps

Welcome to Forge — a storytelling language designed to feel like prose but give you full control over branching, choices, and character knowledge. This tutorial teaches you everything you need to write an interactive story, one step at a time, using the fox-and-crow theme.

By the end, you'll understand: knots, choices, variables, conditionals, diverts, knowledge bindings, and how all of it works together.

---

## Step 1: The Simplest Story — Plain Text

The smallest valid story is just text:

```fable
A fox trotted through the quiet wood.
```

When you run this story, the reader sees exactly that. No choices, no branches — just prose. Save this in a `.fable` file and you have a complete story. That's the first design goal of Forge: *prose first*.

---

## Step 2: Add a Knot — Name Your Scenes

A **knot** is a named scene or chapter. Mark it with `===` and a name:

```fable
=== meeting ===
A crow perches high in the oak tree.
The fox circles below, watching.
```

Knots help you organize. A story can have many knots, and you navigate between them with diverts (which we'll see next). For now, write two knots and link them:

```fable
-> meeting

=== meeting ===
A crow perches high in the oak tree.
The fox circles below, watching.
-> THE END
```

The `->` is a **divert** — it tells Forge to jump to a knot. `END` is special: it means "the story is over, stop here." When you run this, you'll see the fox and crow scene, then the story ends.

---

## Step 3: Add Choices — Let the Reader Decide

Now give the reader options. A line starting with `*` is a once-only choice; it can only be picked once. A line starting with `+` is a sticky choice; it stays available every visit.

```fable
-> meeting

=== meeting ===
A crow perches high in the oak tree.
The fox circles below, watching.
* "What a glorious bird!"
  The crow preens at the compliment.
  -> pleased
+ Watch in silence.
  The crow eyes you warily.
  -> END
```

Indent the text under the choice (it's cosmetic, but it helps readability). When the reader picks a choice, they see both the choice text and everything indented under it.

The choice "What a glorious bird!" leads to a knot called `pleased` (which we haven't written yet). The sticky choice "Watch in silence" goes straight to `END`.

---

## Step 4: Build the Full Knot

Add the missing `pleased` knot:

```fable
-> meeting

=== meeting ===
A crow perches high in the oak tree.
The fox circles below, watching.
* "What a glorious bird!"
  The crow preens at the compliment.
  -> pleased
+ Watch in silence.
  The crow eyes you warily.
  -> END

=== pleased ===
The crow opens her beak to sing.
A wedge of cheese tumbles down.
The fox snaps it up.
-> END
```

Now your story branches: one path leads to the pleased knot (and the fox gets the cheese), the other ends with the crow unimpressed. Run it and pick both paths.

---

## Step 5: Add Variables — Remember the State

Stories remember things. Use `VAR` to create a variable that tracks state:

```fable
VAR flattered = false

-> meeting

=== meeting ===
A crow perches high in the oak tree.
The fox circles below, watching.
* "What a glorious bird!"
  ~ flattered = true
  The crow preens at the compliment.
  -> pleased
+ Watch in silence.
  The crow eyes you warily.
  -> END

=== pleased ===
The crow opens her beak to sing.
A wedge of cheese tumbles down.
The fox snaps it up.
-> END
```

`VAR flattered = false` declares a variable and gives it a starting value. The `~` line is a **logic line** — it runs code without showing text to the reader. Here, we set `flattered = true` when the reader chooses to flatter.

---

## Step 6: Write Conditional Text — Branch Without a Choice

Now make the ending react to what the reader did. Use curly braces `{...}` with a colon to write prose that changes based on a condition:

```fable
VAR flattered = false

-> meeting

=== meeting ===
A crow perches high in the oak tree.
The fox circles below, watching.
* "What a glorious bird!"
  ~ flattered = true
  The crow preens at the compliment.
  -> pleased
+ Watch in silence.
  The crow eyes you warily.
  -> END

=== pleased ===
The crow opens her beak to sing.
A wedge of cheese tumbles down.
The fox snaps it up.
{flattered: Flattery did the work no claw could.|The crow regrets her vanity.}
-> END
```

The syntax is: `{condition: text if true | text if false}`. If `flattered` is true, you see the first line. If false, the second. The `|` separates the branches, and the else-branch (after `|`) is optional.

---

## Step 7: Add a Number Variable — Track a Stat

Characters have stats. Let's give the fox a cunning score:

```fable
VAR flattered = false
VAR fox_cunning = 3

-> meeting

=== meeting ===
A crow perches high in the oak tree.
@fox(Reynard the Fox) circles below, cunning at {fox_cunning}.
* "What a glorious bird!"
  ~ flattered = true
  The crow preens at the compliment.
  -> pleased
+ Watch in silence.
  The crow eyes you warily.
  -> END

=== pleased ===
The crow opens her beak to sing.
A wedge of cheese tumbles down.
The fox snaps it up.
{flattered: Flattery did the work, not cunning.|Even Reynard needs luck.}
-> END
```

Now `{fox_cunning}` displays the value (3) inline. You can also use it in conditions: `{fox_cunning > 2: ...}`.

---

## Step 8: Bind to Knowledge — Link Story and Notes

Here's where Forge becomes a *fusion* tool. Stories can reference notes and entities from your knowledge base. Use `@` for an entity and `[[...]]` for a note:

```fable
VAR flattered = false
VAR fox_cunning = 3

The wood smelled of rain and old oak.
-> meeting

=== meeting ===
A crow perches high in the oak tree.
You recall what the ledger said: [[On Flattery]].
@fox(Reynard the Fox) circles below, cunning at {fox_cunning}.
* "What a glorious bird!"
  ~ flattered = true
  The crow preens at the compliment.
  -> pleased
+ Watch in silence.
  The crow eyes you warily.
  -> END

=== pleased ===
The crow opens her beak to sing.
A wedge of cheese tumbles down.
@fox snaps it up.
{flattered: Flattery did the work, not cunning.|Even Reynard needs luck.}
-> END
```

`@fox(Reynard the Fox)` references an entity called "fox" with display text "Reynard the Fox". When played, it shows "Reynard the Fox" and adds that entity to the reader's codex. You can also use `@fox.cunning` to read a field directly from the entity — the story gets live data from your knowledge base.

`[[On Flattery]]` embeds a link to a note titled "On Flattery" — the reader can tap it during playback. If the note doesn't exist yet, the link stays inert but the story still works.

---

## Step 9: Add Choice Conditions — Gate Paths Behind Knowledge

Make a choice available only if a condition is true:

```fable
VAR flattered = false
VAR fox_cunning = 3
VAR has_cheese = false

The wood smelled of rain and old oak.
-> meeting

=== meeting ===
A crow perches high in the oak tree.
You recall what the ledger said: [[On Flattery]].
@fox(Reynard the Fox) circles below, cunning at {fox_cunning}.

* "What a glorious bird!"
  ~ flattered = true
  The crow preens at the compliment.
  -> pleased
+ Watch in silence.
  The crow eyes you warily.
  -> END

=== pleased ===
The crow opens her beak to sing.
A wedge of cheese tumbles down.
~ has_cheese = true
@fox snaps it up.
{flattered: Flattery did the work, not cunning.|Even Reynard needs luck.}
-> END
```

You can add `{condition}` between the choice marker and the text to show it only when true:

```fable
* {has_cheese} Offer the cheese to the crow.
  The crow is surprised but pleased.
  -> END
```

This choice appears only if `has_cheese` is true. Use conditions to hide spoiler choices, gate advanced paths, or show different options based on what happened before.

---

## Step 10: Read the Spec and Explore

You now know the core of Forge. To go deeper:

- **Variables**: `VAR`, `CONST`, `~ temp` variables (scoped to a knot), and assignment with `~`
- **Operators**: arithmetic (`+`, `-`, `*`, `/`), comparisons (`>`, `<`, `==`), lists (`+` to add, `-` to remove, `has` to test), and boolean logic (`&&`, `||`, `not`)
- **Inline expressions**: Use `{expr}` anywhere to interpolate a value, or `{cond: then | else}` for branching text without choices
- **Alternatives**: `{a | b | c}` picks a different branch each visit (sequence), `{& a | b | c}` cycles, `{~ a | b | c}` picks randomly
- **Gathers**: `-` lines rejoin flow after nested choices (like a merge point in a flowchart)
- **Labels**: Mark a choice or gather with `(name)` to give it an address and track how many times it's been visited with `(name) > 0`
- **Built-ins**: `RANDOM(min, max)`, `COUNT(list)`, `FLOOR()`, `CEILING()`, `MIN()`, `MAX()`, `TURNS()` for the turn count, and more
- **Story header**: Write `# title: ...` and `# author: ...` at the very top to set metadata
- **Tags**: Add `# tag: value` anywhere on a line for the runtime (e.g., `# mood: somber`)

---

## Complete Example: The Fox and the Crow

Here's the full story you've built, ready to run:

```fable
# title: The Fox & The Crow, Retold
# author: You

VAR flattered = false
VAR fox_cunning = 3
VAR has_cheese = false

The wood smelled of rain and old oak.
-> meeting

=== meeting === # scene: the branch
A crow perches high in the oak tree.
You recall what the ledger said: [[On Flattery]].
@fox(Reynard the Fox) circles below, cunning at {fox_cunning}.

* "What a glorious bird!"
  ~ flattered = true
  The crow preens at the compliment.
  -> pleased
+ Watch in silence.
  The crow eyes you warily.
  -> END

=== pleased === # scene: the taking
The crow opens her beak to sing.
A wedge of cheese tumbles down.
~ has_cheese = true
@fox snaps it up.
{flattered: Flattery did the work, not cunning.|Even Reynard needs luck.}
-> END
```

---

## Next Steps

Now that you understand the language:

1. **Write a story of your own** — pick a theme and build it knot by knot
2. **Read the Forge spec** (`docs/forge/spec.md`) — it covers every feature in detail
3. **Explore the cookbook** (`docs/cookbook/fusion.md`) — see how to weave knowledge and narrative together
4. **Check the demo stories** — `docs/demo/aesop/` has two real, runnable stories that show off the fusion system

---

## Common Patterns

### The Test Choice
Always end with a sticky `+` that loops back, so the reader can re-explore branches:

```fable
=== scene ===
Something happens.
* Once-only path.
  -> next_scene
+ Test again.
  -> scene
```

### The Stat Check
Hide a choice behind a numerical threshold:

```fable
VAR charisma = 2

* {charisma > 2} Talk your way out.
  -> escape
```

### The Inventory System
Use a list to track what the player carries:

```fable
VAR inventory = ["torch", "rope"]

~ inventory = inventory + "key"
{inventory has "key": You have the key!}
~ inventory = inventory - "rope"
{inventory hasnt "rope": The rope is gone.}
You carry {COUNT(inventory)} items.
```

### The Journal Write
Stories can write to the reader's journal (a special note in the knowledge base):

```fable
@journal(The fox stole the cheese at noon)
```

This appears in the daily note when the story runs, creating a permanent record.

---

**Ready to play?** Pick a story from the Fables demo, or open a new story in the app and paste in your first script. Press **Playtest** and read your own words come alive.
