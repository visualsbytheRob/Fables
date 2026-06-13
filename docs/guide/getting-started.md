# Getting Started with Fables

Welcome! Fables is where your notes and your stories live together. This guide walks you through the knowledge side — how to write notes, link them together, explore your growing library, and get ready for storytelling.

## Your Knowledge Base: How It Works

When you open Fables, you land in the **knowledge view**. It's where you:

- Write and edit notes in plain Markdown
- Link notes together with wikilinks (`[[Note Title]]`)
- Explore your notes as a graph
- Write daily notes and tag them
- Search for anything by full text

Your notes live in `~/.fables` on your machine — no cloud, no sync yet, just local files you control.

## Step 1: Write Your First Note

1. Open Fables and click **New Note**.
2. Give it a title (e.g., "Aesop's Fables").
3. Write something:
   ```
   # Aesop's Fables
   
   A collection of moral tales about animals.
   Started reading these with my kids in June 2026.
   ```
4. Click **Save**.

That's it. Your note is now part of your library.

## Step 2: Link Notes Together

Notes become powerful when they talk to each other. Use **wikilinks** to connect them.

Write another note called "The Fox and the Crow":

```
# The Fox and the Crow

One of the most famous fables in [[Aesop's Fables]].

The story teaches us about [[flattery]] and [[pride]].
```

When you save, you'll see that `[[Aesop's Fables]]` becomes a tappable link. Clicking it takes you to that note. Even though you haven't created "flattery" or "pride" yet, they show up as unresolved links — a reminder to flesh out your library later.

### Link syntax rules

- Use double square brackets: `[[Note Title]]`
- The title must match exactly (case-insensitive)
- You can link to a note before it exists
- In stories, the same syntax embeds lore

## Step 3: Explore the Graph

As you add notes and links, a **graph view** emerges. Click the graph icon to see your notes as nodes connected by links. This is how you discover:

- Which notes are isolated (orphaned, no links in or out)
- Clusters of related ideas
- The overall shape of your thinking

The graph updates live as you edit.

## Step 4: Tag Your Notes

Tags are like labels without the structure of folders. Add a `#tag` anywhere in your note:

```
# The Fox and the Crow

#fable #animals #morality

One of the most famous fables...
```

Tags help you group notes by theme, emotion, project, or season. You can filter by tag or search across tagged notes.

## Step 5: Daily Notes and Your Journal

Every day in Fables, you can write in your **daily note** — a journal entry for today. Click the calendar icon and start typing. Your daily note is just a regular note, but it has today's date as its title and stays front-and-center.

Daily notes are perfect for:

- Tracking what you read or learned
- Reflecting on the day
- Writing session notes
- Logging story playthroughs (especially when a story writes its own `@journal(...)` entries while you play)

## Step 6: Search Your Library

Click the search icon to search all your notes. Fables searches:

- **Full text** — finds any word in any note
- **Titles** — shows notes whose titles match first
- **Linked context** — ranks results by how connected they are

Try searching for a phrase you know you wrote. Even if you forget which note it was in, search finds it instantly.

## Step 7: Import Notes

If you have notes in another format (Markdown files, a text file, or notes from another app), you can bulk-import them:

1. Go to **Settings** → **Import Notes**
2. Choose a directory or paste Markdown text
3. Fables ingests them and adds them to your library

Each note becomes searchable and linkable. You can clean up titles and links afterward.

## Your First Week

Here's a light path to get comfortable:

### Day 1: Set up your core topics
- Create 3–5 foundational notes on what interests you (e.g., "Books I'm Reading," "People," "Ideas")
- Give each a short description

### Day 2–3: Build out some depth
- Add more notes related to your core topics
- Link them together with wikilinks
- Don't worry about being perfect — you'll refine this over time

### Day 4: Live with it
- Open your daily note each morning and write a sentence
- Search for something you wrote days ago — get a feel for the recall speed
- Click around the graph and see how your thinking connects

### Day 5–7: Add a story
- In a new section of Fables, create a story (you'll see how in the Forge tutorial)
- Let the story reference your notes — watch how knowledge and narrative fuse together
- Play through your story and see your journal entry grow

## Common Patterns

### The Reading Log
Create a "Reading" note with links to each book or article you finish:

```
# Reading

## 2026

- [[The Fox and the Crow]] (Aesop, June)
- [[Thinking, Fast and Slow]] (Kahneman, June)
```

When you write a note about a book, link back to "Reading." Now your library knows what you've consumed.

### The Character Sheet
If you're writing fiction, each character can be a note:

```
# Reynard

A clever fox with a sharp tongue.

Appears in: [[The Fox and the Crow]], [[The Fable of Greed]]

Traits: #cunning #vain #survival-driven
```

### The Idea Capture
Write a short note every time an idea strikes:

```
# What if stories could edit themselves?

Imagine a branching narrative where reader choices don't just change the plot,
but actually rewrite the notes that the story references.
```

Link it to related ideas, tag it #writerly-thoughts, and come back to it later.

## Tips and Tricks

**Backlinking**: When you view a note, scroll down to see all notes that link *to* it — a reverse index of context.

**Quick navigation**: Press `/` to open the command palette and jump to a note, create a new one, or search without using the mouse.

**Plain Markdown everywhere**: If you export your notes or switch tools later, everything is readable plain text.

**Orphaned notes**: Every so often, check your graph for isolated notes. They might be ideas you've forgotten about — or they might need better connection.

## Next Steps

Once you're comfortable with notes and links:

- **Learn Forge** — head to the **Forge Tutorial** to write your first interactive story
- **Explore the Cookbook** — see how to fuse knowledge and narrative together (characters as notes, choices that write journal entries, etc.)
- **Run a story** — click **Playtest** to read a story you've written and watch your knowledge base update in real time

---

**Questions?** The best way to learn is to write something, make a link, and see what breaks. Fables is designed to tell you when something is wrong, so don't be afraid to experiment.
