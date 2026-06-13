# The Fusion Cookbook: Weaving Knowledge and Stories

The heart of Fables is *fusion* — the merger of your knowledge base and your interactive stories. These recipes show you how to combine them in practical ways. Each recipe is a small, complete story + setup that you can adapt to your own writing.

---

## Recipe 1: Give a Character a Stat That Choices Change

**The problem:** You want a character's health or mood to change based on reader choices, and see that change reflected in the story output.

**The setup:**

In your knowledge base, create an entity called "Fox" with a field `health: 5`.

**The story:**

```fable
VAR trust = 0

-> meeting

=== meeting ===
@Fox prowls the clearing, health at @Fox.health.
* Be kind.
  ~ trust = trust + 1
  @Fox seems pleased. Trust: {trust}.
  -> meeting
* Be harsh.
  ~ trust = trust - 1
  @Fox bristles. Trust: {trust}.
  -> meeting
+ Leave.
  {trust > 0: The fox nods goodbye.|The fox glares as you go.}
  -> END
```

**How it works:**

- `@Fox.health` reads the current health value directly from the entity in your knowledge base
- Each choice updates a `VAR trust` that lives in the story
- The final conditional branches on how much trust you built
- Both local story state (`trust`) and knowledge state (`@Fox.health`) coexist

**Tip:** If you want to *permanently* change an entity's health, use a journal write (`@journal(Fox's health is now 3)`) to record it, then update the entity by hand later. Client-side mutation of entities isn't supported yet, but journaling creates a readable trail.

---

## Recipe 2: Reveal a Codex Entry When the Reader Meets Someone

**The problem:** The first time the reader encounters a character, that character should appear in their codex. Subsequent references should only count if they're new entity bindings.

**The setup:**

Create entities for: Fox, Crow, Lion.

**The story:**

```fable
VAR met_lion = false

-> crossroads

=== crossroads ===
You stand at a fork in the road.
* Head toward the forest.
  @Fox watches from the bracken.
  -> meeting_done
* Head toward the mountain.
  ~ met_lion = true
  @Lion guards the pass, regal and still.
  -> meeting_done

=== meeting_done ===
{met_lion: The Lion's cold gaze follows you.|The Fox's tail flicks knowingly.}
-> END
```

**How it works:**

- Each `@Entity` reference is a codex entry — the runtime tracks unique entities you've seen
- By the end of the story, the reader's codex contains everyone they actually met
- The conditional changes the output text to reflect which path was taken

**Tip:** Entity display text (`@Fox(Reynard the Fox)`) creates a richer codex entry. Use it the first time you introduce a character formally.

---

## Recipe 3: Write a Journal Entry From Inside a Story

**The problem:** As the reader explores the story, you want to leave breadcrumbs in their journal (daily note) so they have a record of their playthrough.

**The setup:**

No special setup — the `@journal(...)` effect is built into Forge.

**The story:**

```fable
-> the_hunt

=== the_hunt ===
The tracking was easy. The kill was easier.
@journal(Hunted and caught prey at dawn)
+ Celebrate the catch.
  You feast under the morning sun.
  @journal(Feasted on fresh meat)
  -> END
```

**How it works:**

- `@journal(...)` writes directly to the reader's daily note
- Each journal call adds a line, creating a chronological record
- The reader can review their playthrough by opening today's note

**Tip:** Use journal entries for: plot summaries, moral choices, key decisions, or flavor flavor text ("Met the Crow at the old oak"). They're not hidden from the reader — they create a shared record.

---

## Recipe 4: Link Story Lore to a Note

**The problem:** While telling a story, you want to embed references to notes in your knowledge base so the reader can dive deeper on demand.

**The setup:**

Create a note titled "On Pride".

**The story:**

```fable
-> confrontation

=== confrontation ===
The great beast stands in your way.
You feel the pull of challenge.
You recall what the elders taught: [[On Pride]].
* Bow respectfully.
  The beast lets you pass.
  -> END
* Meet its gaze without flinching.
  The beast roars. Combat is certain.
  -> battle

=== battle ===
A harder lesson than pride could teach.
-> END
```

**How it works:**

- `[[Note Title]]` creates an embedded link to your knowledge base
- During play, the reader can tap it to read that note
- If the note doesn't exist yet, the link stays inert but the story still runs
- The story and notes are separate until the reader clicks — no preloading

**Tip:** Use note embeds for: historical context, moral commentary, worldbuilding details, or references to real sources. They work best when they're optional flavor, not required to understand the story.

---

## Recipe 5: Gate a Path Behind What the Reader Knows

**The problem:** A choice should only appear if the reader has read a certain note (e.g., a secret password that was explained in the knowledge base).

**The setup:**

Create a note titled "The Secret Gate" that contains the word "silver".

**The story:**

```fable
VAR knows_secret = false

-> the_gate

=== the_gate ===
A stone door bars your way. There's a lock shaped like a crescent.
* {knows_secret} Whisper "silver" to the lock.
  The door swings open.
  -> beyond
+ Turn back.
  -> END

=== beyond ===
The passage beyond glimmers with moonlight.
-> END
```

**The truth:** Unfortunately, Forge's current compiler doesn't have a way to check "has the reader visited note X?" at compile time. But you can simulate it:

1. Before playing the story, the reader reads "The Secret Gate" note
2. You ask them: "Did you read the secret note?" and set `~ knows_secret = true` with a choice
3. Or: add an optional choice at the start: `* "I know the secret." ~ knows_secret = true`

**Tip:** A cleaner pattern is to put the secret directly in the story and use a conditional to hide it until the reader has made the right choice. See Recipe 1 (Stat Changes) for an example.

---

## Recipe 6: A Character Whose Personality Is Driven by an Entity Field

**The problem:** A character's dialogue should change based on their entity data — if the character is "calm" they speak softly, if "angry" they shout.

**The setup:**

Create an entity "Sage" with a field `mood: "serene"` (or `mood: "wrathful"`).

**The story:**

```fable
-> audience

=== audience ===
The Sage sits in meditation.
{@Sage.mood == "serene": You bow quietly.}
{@Sage.mood == "wrathful": The Sage's eyes snap open.|The Sage nods slightly.}

* Ask for wisdom.
  {@Sage.mood == "serene": "What you seek lies within," the Sage whispers.|"Begone!" the Sage roars.}
  -> END
```

**How it works:**

- `@Sage.mood` is a field of type string (you set it in the entity definition)
- Each conditional checks the current value and branches the text
- The same story, played twice with different entity data, reads completely differently

**Tip:** If you want the mood to change *during* the story, use a `VAR mood` inside the story instead. Store the initial value from the entity at the start: `VAR mood = @Sage.mood`.

---

## Recipe 7: Choices That Are Only Available if You've Already Made Them

**The problem:** A sticky choice (`+`) should stay available, but you only want to show it after the reader has chosen it once (a "return to the scene" option after the first branch).

**The setup:**

Track a boolean flag.

**The story:**

```fable
VAR explored_west = false

-> crossroads

=== crossroads ===
Three paths diverge.
* Explore the western trail.
  ~ explored_west = true
  You find an old shrine.
  -> shrine
+ {explored_west} Return to the western shrine.
  The shrine is unchanged.
  -> shrine
+ Head back to town.
  -> END

=== shrine ===
The shrine is quiet.
-> crossroads
```

**How it works:**

- `~ explored_west = true` marks that the path has been taken
- The sticky choice `+ {explored_west} Return...` only shows after the first visit
- Once available, it stays available forever

**Tip:** This pattern works for any "unlock after doing X" mechanic: reading a note, collecting an item, reaching a stat threshold, etc.

---

## Recipe 8: A Multi-Path Story That Reconverges

**The problem:** The reader chooses between two major branches early on, but the story rejoins later (e.g., two paths up a mountain that meet at the summit).

**The setup:**

None — this is pure Forge flow control.

**The story:**

```fable
VAR took_north = false

-> split

=== split ===
The trail forks. Which way?
* Take the north path.
  ~ took_north = true
  You climb steadily through cool forest.
  -> approach
* Take the south path.
  You walk through open meadow, hot sun on your face.
  -> approach

=== approach ===
The mountain looms ahead. Snow crowns its peak.
{took_north: The forest path was easier.|The meadow path was scenic.}
+ Press onward.
  -> summit

=== summit ===
You reach the top. The view is vast.
-> END
```

**How it works:**

- Both branches divert to the same knot (`approach`)
- The `VAR took_north` flag remembers which path was taken
- Later text can reference it with conditionals
- The story feels like it had multiple threads that came together

**Tip:** This is elegant for long stories with meaningful but ultimately reconciled divergence. Use it sparingly — too many reconverges can feel like the player's choices don't matter.

---

## Recipe 9: A "Collectible" System (Inventory)

**The problem:** The reader picks up items and the story should react based on what they carry.

**The setup:**

None — Forge has lists.

**The story:**

```fable
VAR inventory = []

-> camp

=== camp ===
You're at an old campfire.
* Pick up the torch.
  ~ inventory = inventory + "torch"
  You have {COUNT(inventory)} items now.
  -> camp
* Pick up the rope.
  ~ inventory = inventory + "rope"
  You have {COUNT(inventory)} items now.
  -> camp
* {inventory has "torch"} Light a fire with the torch.
  The fire roars to life, warmth spreads.
  -> END
* {inventory hasnt "torch"} Try to start a fire.
  Without fuel or spark, you fail.
  -> END
```

**How it works:**

- `VAR inventory = []` starts with an empty list
- `inventory + "item"` adds an item
- `inventory - "item"` removes an item
- `inventory has "item"` and `inventory hasnt "item"` test membership
- `COUNT(inventory)` gives the number of items

**Tip:** For a richer system, use entity names: `~ inventory = inventory + "key of silver"` and check with `{inventory has "key of silver": ...}`. Or store only IDs and display names with `@`.

---

## Recipe 10: A Story That Teaches a Concept by Testing It

**The problem:** You're writing an educational fable. The reader should learn by making choices and seeing consequences, not by exposition.

**The setup:**

Create a note titled "Prudence" that explains why patience beats rushing.

**The story:**

```fable
# title: The Lesson of Prudence
# author: You

VAR lesson_learned = false

-> scenario

=== scenario ===
A fox guards three hens. Only one is loose today.
You could pounce now, or wait for the other two to wander.
* Rush and grab the one hen.
  You succeed, but the fox chases you off.
  -> reflection
* Wait and watch.
  ~ lesson_learned = true
  Patience pays. All three hens are now in reach.
  -> triumph

=== reflection ===
You got what you came for, but no more.
You recall: [[Prudence]].
{lesson_learned: You finally understand.|You're still learning.}
-> END

=== triumph ===
A reward for patience.
-> END
```

**How it works:**

- Each choice path leads to a different outcome
- The "right" choice (waiting) sets `lesson_learned = true`
- Even the "wrong" path acknowledges the note, inviting reflection
- The reader learns by doing, not by being told

**Tip:** Best fables let the reader fail and succeed equally. Don't make the "lesson" path the only success — make both paths interesting and let the reader decide what they learned.

---

## Putting It Together: A Complete Fusion Story

Here's a small story that uses multiple recipes:

```fable
# title: The Merchant's Dilemma
# author: You

VAR reputation = 0
VAR sold_fairly = false

-> market

=== market ===
An old merchant in the square eyes you carefully.
You recall what you learned: [[On Honesty]].
@merchant(The Merchant) nods.
"You look like someone who trades fairly. Or perhaps not."

* Sell your wares fairly.
  ~ sold_fairly = true
  ~ reputation = reputation + 2
  @journal(Traded fairly with the merchant)
  @merchant seems pleased.
  -> closing
* Cheat on the weights.
  ~ reputation = reputation - 1
  @journal(Cheated the merchant)
  @merchant's eyes narrow.
  -> closing

=== closing ===
{reputation > 0: The merchant recommends you to others.|The merchant never speaks of you again.}
{sold_fairly: Honesty builds slowly.|Quick gains fade fast.}
-> END
```

**What's happening here:**

1. A stat (`reputation`) tracks cumulative choices
2. A boolean (`sold_fairly`) flags a key decision
3. An entity (`@merchant`) makes it personal
4. A note embed (`[[On Honesty]]`) grounds the story in your library
5. A journal entry creates a permanent record
6. Multiple conditionals show how consequences ripple

---

## Tips for Fusion Storytelling

1. **Keep knowledge optional.** A reader shouldn't *need* to read a note to understand the story — notes are depth, not requirements.

2. **Use entities for characters, not objects.** Bind to people and creatures; for items, use strings in lists.

3. **Write the story first, wire the knowledge second.** Get the branches and choices right, then add `@entity` and `[[note]]` references.

4. **Test without the knowledge base.** If you remove all `@` and `[[]]` references, does the story still make sense? If not, you're over-reliant on external knowledge.

5. **Journal early, often.** Let the reader see their playthrough in their daily note. It's the closest thing to saves you have right now.

6. **Version your entities.** If a character's mood or stats matter, update the entity after the story and save a snapshot of what changed. Future stories can reference that state.

---

**Ready to write?** Pick a recipe, adapt it to a character or world you love, and see what happens. The best stories are the ones you finish — start small and build.
