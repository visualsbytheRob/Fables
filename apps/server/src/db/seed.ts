import type { Db } from './connection.js';
import { withTransaction } from './connection.js';
import { notebooksRepo } from './repos/notebooks.js';
import { notesRepo } from './repos/notes.js';

/** Seeds a fresh vault with a starter notebook and welcome notes. No-op if data exists. */
export function seed(db: Db): { seeded: boolean } {
  const notes = notesRepo(db);
  if (notes.count() > 0) return { seeded: false };

  withTransaction(db, () => {
    const notebooks = notebooksRepo(db);
    const inbox = notebooks.create({ name: 'Inbox' });
    const journal = notebooks.create({ name: 'Journal' });
    void journal;

    notes.create({
      notebookId: inbox.id,
      title: 'Welcome to Fables',
      body: [
        '# Welcome to Fables',
        '',
        'Your notes are the world. Your stories run on a compiler you own.',
        '',
        '- Write notes in markdown, link them with [[wikilinks]]',
        '- Author interactive fables in the Forge',
        '- Read everything on your phone over Tailscale',
      ].join('\n'),
    });
    notes.create({
      notebookId: inbox.id,
      title: 'The Fox',
      body: 'A sly character who will star in your first story. See [[Welcome to Fables]].',
    });
  });
  return { seeded: true };
}
