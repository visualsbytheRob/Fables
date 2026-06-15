/**
 * Demo world v2 (F694–F699).
 *
 * Seeds a fresh vault with a guided tour of the system: notebooks, tagged and
 * wikilinked notes, a daily-note journal, saved FQL queries plus a dashboard
 * note that embeds them, and a compiled Forge story — so a new install opens to
 * something alive that exercises notes, links, tags, queries and the Forge
 * engine. Idempotent: a no-op when the vault already has notes.
 */

import type { Db } from '../db/connection.js';
import { withTransaction } from '../db/connection.js';
import type { NoteId } from '@fables/core';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { tagsRepo } from '../db/repos/tags.js';
import { savedQueriesRepo } from '../db/repos/saved-queries.js';
import { storiesRepo } from '../db/repos/stories.js';
import { syncNoteLinks } from '../services/links.js';
import { recompileStory } from '../stories/service.js';

const DEMO_STORY = `-> clearing

=== clearing ===
A fox trots into a moonlit clearing. A crow sits above with a wedge of cheese.
+ Flatter the crow.
  "What a beautiful voice you must have," says the fox.
  The crow caws, and the cheese falls.
  -> END
+ Walk away.
  The fox decides honesty is the better policy tonight.
  -> END
`;

export interface DemoSummary {
  seeded: boolean;
  notes: number;
  notebooks: number;
  savedQueries: number;
  story: string | null;
}

/** Seed the demo world. No-op (returns seeded:false) if the vault has notes. */
export function seedDemoWorld(db: Db): DemoSummary {
  const notes = notesRepo(db);
  if (notes.count() > 0) {
    return { seeded: false, notes: 0, notebooks: 0, savedQueries: 0, story: null };
  }

  const notebooks = notebooksRepo(db);
  const tags = tagsRepo(db);
  const saved = savedQueriesRepo(db);

  const counts = { notes: 0, notebooks: 0, savedQueries: 0 };
  let storyId: string | null = null;

  const tag = (id: NoteId, ...names: string[]): void => {
    for (const name of names) tags.linkNote(id, tags.ensure(name).id, false);
  };
  const linkUp = (id: NoteId): void => {
    const note = notes.get(id);
    if (note) syncNoteLinks(db, note);
  };

  withTransaction(db, () => {
    const inbox = notebooks.create({ name: 'Inbox' });
    const journal = notebooks.create({ name: 'Journal' });
    const world = notebooks.create({ name: 'Worldbuilding' });
    counts.notebooks = 3;

    const welcome = notes.create({
      notebookId: inbox.id,
      title: 'Welcome to Fables',
      body: [
        '# Welcome to Fables',
        '',
        'Your notes are the world. Your stories run on a compiler you own.',
        '',
        '- Write notes in markdown, link them with [[wikilinks]]',
        '- Author interactive fables in the Forge — try [[The Fox and the Crow]]',
        '- See your [[Dashboard]] for live queries',
      ].join('\n'),
    });
    tag(welcome.id, 'start');

    const fox = notes.create({
      notebookId: world.id,
      title: 'The Fox',
      body: 'A sly character. Flattery is the fox’s favourite tool. Appears in [[The Fox and the Crow]].',
    });
    tag(fox.id, 'character');

    const crow = notes.create({
      notebookId: world.id,
      title: 'The Crow',
      body: 'Vain and easily flattered. Holds the cheese in [[The Fox and the Crow]].',
    });
    tag(crow.id, 'character');

    // A small daily-note journal (F694).
    const days = ['2026-06-13', '2026-06-14', '2026-06-15'];
    for (const day of days) {
      const entry = notes.create({
        notebookId: journal.id,
        title: day,
        body: `# ${day}\n\nWrote a little more of [[The Fox and the Crow]]. Tagged some [[The Fox]] lore.`,
      });
      tag(entry.id, 'journal', 'daily');
      linkUp(entry.id);
    }

    // Saved queries + a dashboard note that embeds them (F695).
    saved.create({ name: 'Characters', fql: 'tag:character', pinned: true });
    saved.create({ name: 'This week’s journal', fql: 'notebook:Journal updated:>7d' });
    counts.savedQueries = 2;

    const dashboard = notes.create({
      notebookId: inbox.id,
      title: 'Dashboard',
      body: [
        '# Dashboard',
        '',
        '## Characters',
        '```query',
        'tag:character',
        '```',
        '',
        '## Recent journal',
        '```query',
        'notebook:Journal sort:updated desc',
        '```',
      ].join('\n'),
    });
    tag(dashboard.id, 'start');

    // Resolve wikilinks across the seeded notes.
    for (const id of [welcome.id, fox.id, crow.id, dashboard.id]) linkUp(id);

    counts.notes = notes.count();

    // A compiled Forge story (F699 — compiles & plays).
    const stories = storiesRepo(db);
    const story = stories.create({
      title: 'The Fox and the Crow',
      description: 'A one-scene fable adapted from Aesop.',
    });
    stories.createFile(story.id, story.entryFile, DEMO_STORY);
    recompileStory(db, story.id);
    storyId = story.id;
  });

  return {
    seeded: true,
    notes: counts.notes,
    notebooks: counts.notebooks,
    savedQueries: counts.savedQueries,
    story: storyId,
  };
}
