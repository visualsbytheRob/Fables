/**
 * Decks repo tests (F1741/F1743/F1745/F1746).
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../connection.js';
import { migrate } from '../migrate.js';
import { decksRepo } from './decks.js';
import { cardsRepo } from './cards.js';
import { notesRepo } from './notes.js';
import { notebooksRepo } from './notebooks.js';
import { tagsRepo } from './tags.js';
import { RATING } from '../../learning/fsrs.js';

function fresh() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

describe('dynamic membership (F1741)', () => {
  it('a deck filter selects matching cards live', () => {
    const db = fresh();
    const decks = decksRepo(db);
    const cards = cardsRepo(db);
    cards.create({ prompt: 'q1', answer: 'a', kind: 'cloze' });
    cards.create({ prompt: 'q2', answer: 'a', kind: 'basic' });

    const deck = decks.create({ name: 'Cloze deck', filter: { kind: 'cloze' } });
    expect(decks.members(deck.id)).toHaveLength(1);

    // Adding another matching card joins the deck automatically.
    cards.create({ prompt: 'q3', answer: 'a', kind: 'cloze' });
    expect(decks.members(deck.id)).toHaveLength(2);
  });
});

describe('tag-driven decks (F1745)', () => {
  it('selects cards whose source note carries the tag', () => {
    const db = fresh();
    const nb = notebooksRepo(db).create({ name: 'NB' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 'T', body: 'b' });
    const tag = tagsRepo(db).create({ name: 'biology' });
    tagsRepo(db).linkNote(note.id, tag.id, false);

    const cards = cardsRepo(db);
    cards.create({ prompt: 'tagged', answer: 'a', noteId: note.id });
    cards.create({ prompt: 'untagged', answer: 'a' });

    const deck = decksRepo(db).create({ name: 'Bio', filter: { tag: 'biology' } });
    const members = decksRepo(db).members(deck.id);
    expect(members).toHaveLength(1);
    expect(members[0]!.prompt).toBe('tagged');
  });
});

describe('dashboard forecast (F1743)', () => {
  it('counts due and buckets upcoming cards by day', () => {
    const db = fresh();
    const cards = cardsRepo(db);
    const decks = decksRepo(db);
    const c = cards.create({ prompt: 'q', answer: 'a' });
    // Review so it has a due date in the future.
    cards.review(c.id, RATING.Easy, '2026-06-15T10:00:00.000Z');
    cards.create({ prompt: 'new', answer: 'a' }); // a new card

    const deck = decks.create({ name: 'All', filter: {} });
    const dash = decks.dashboard(deck.id, '2026-06-15T10:00:00.000Z', 30);
    expect(dash.total).toBe(2);
    expect(dash.newCards).toBe(1);
    expect(dash.forecast.length).toBe(30);
    // The reviewed card lands somewhere in the forecast window.
    expect(dash.forecast.reduce((n, f) => n + f.count, 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('.fdeck export/import (F1746)', () => {
  it('round-trips a deck and its cards', () => {
    const db = fresh();
    const cards = cardsRepo(db);
    const decks = decksRepo(db);
    cards.create({ prompt: 'shared q', answer: 'shared a', kind: 'basic' });
    const deck = decks.create({ name: 'Shareable', filter: {} });

    const snapshot = decks.exportDeck(deck.id)!;
    expect(snapshot.format).toBe('fdeck');
    expect(snapshot.cards.length).toBe(1);

    // Import into a fresh db.
    const db2 = fresh();
    const imported = decksRepo(db2).importDeck(snapshot);
    expect(imported.name).toBe('Shareable');
    expect(cardsRepo(db2).browse({}).length).toBe(1);
  });
});
