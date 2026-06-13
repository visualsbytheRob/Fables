# The Aesop Engine — Fables demo world

A small, self-contained demo that shows off what makes Fables a *fusion* tool:
notes, entities, and interactive stories woven into one reading experience. Two
short fables share a cast of entities and lean on lore embeds, the spoiler-safe
codex, and the journal so you can see all three pillars working together.

## The cast (entities)

The stories bind to a handful of fable entities. Create these as entities in
your Fables library (a name, a type, and the fields below) so the `@Name` and
`@Name.field` references resolve:

| Entity | Type      | Fields                     |
| ------ | --------- | -------------------------- |
| Fox    | character | `cunning` (number), `mood` |
| Crow   | character | `cunning` (number), `mood` |
| Lion   | character | `mood`, `regal` (boolean)  |

Names are matched case-insensitively, and a story that reads `@Fox.cunning`
pulls the value straight from the entity — change it once and every story
updates.

## The lore (notes)

The fables embed a few notes by title with `[[double brackets]]`. Create notes
with these titles so the embeds resolve to tappable lore links:

- `On Flattery`
- `The Vanity of Crows`
- `Aesop's Morals`
- `The Lion's Court`
- `On Pride`

Deleted or missing notes degrade gracefully to inert links, so the stories
still read fine even before you create them.

## The two stories

### `fox-and-crow.fable` — "The Fox & The Crow, Annotated"

A faithful retelling of the classic fable. The reader chooses whether to flatter
the crow or wait in silence, and the moral changes accordingly. It demonstrates:

- `@entity` display refs (`@Crow`, `@Fox(Reynard)`) — these populate the codex.
- An `@entity.field` knowledge read (`@Fox.cunning`).
- Inline lore embeds (`[[On Flattery]]`, `[[The Vanity of Crows]]`).
- A `# scene:` tag on the opening knot.

### `crossroads.fable` — "The Crossroads of Beasts"

A branching fable: honour the Lion or challenge him, then walk one of two roads
and face his verdict. It demonstrates:

- Branching choices that diverge and reconverge at `reckoning`.
- Journal writes via `@journal(...)` — the reader's playthrough leaves a trail.
- Codex reveals as `@Fox`, `@Crow`, and `@Lion` surface across different
  branches (you meet a different cast depending on your path).
- Story state via `VAR trust` / `VAR lion_mood` driving conditional text.

> **Note on entity mutation.** An earlier draft mutated entity fields with an
> `ENTITY_SET` effect. The client-side compiler treats unrecognised effect
> calls as unknown functions (FORGE203), so the demo uses a `VAR` to track the
> Lion's mood and `@journal(...)` to record the playthrough instead — both of
> which compile cleanly and still surface in the journal/codex flow.

## Loading the demo

The `pnpm seed:demo` script (F698) is **deferred** — it is not yet built. For
now, load the demo by hand:

1. Create the entities and notes listed above in your Fables library.
2. Create a new story (e.g. "The Fox & The Crow").
3. Open its `main.fable` and paste in the contents of `fox-and-crow.fable`.
4. Repeat for `crossroads.fable` in a second story.
5. Press **Run** in the playtest pane, or open it in the player to watch the
   codex and journal fill in as you read.

Both `.fable` files are verified to compile by
`apps/web/src/stories/demo.test.ts`.
