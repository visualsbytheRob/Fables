/**
 * Cards repo tests (F1701/F1703/F1705/F1706/F1707/F1718).
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../connection.js';
import { migrate } from '../migrate.js';
import { cardsRepo } from './cards.js';
import { notesRepo } from './notes.js';
import { notebooksRepo } from './notebooks.js';
import { RATING } from '../../learning/fsrs.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

describe('card lifecycle (F1701/F1703)', () => {
  it('creates a new card, reviews it, and logs the review', () => {
    const repo = cardsRepo(freshDb());
    const card = repo.create({ prompt: 'capital of France?', answer: 'Paris' });
    expect(card.state).toBe('new');
    expect(card.due).toBeNull();

    const reviewed = repo.review(card.id, RATING.Good, '2026-06-15T10:00:00.000Z')!;
    expect(reviewed.state).toBe('review');
    expect(reviewed.due).not.toBeNull();
    expect(reviewed.reps).toBe(1);

    const log = repo.reviewLog(card.id);
    expect(log).toHaveLength(1);
    expect(log[0]!.rating).toBe(RATING.Good);
  });
});

describe('due queue + new-card limits (F1705/F1706)', () => {
  it('returns due review cards plus a capped intake of new cards', () => {
    const repo = cardsRepo(freshDb());
    // One reviewed card, due in the past.
    const due = repo.create({ prompt: 'a', answer: '1' });
    repo.review(due.id, RATING.Good, '2026-06-01T10:00:00.000Z');
    // Three new cards.
    for (let i = 0; i < 3; i++) repo.create({ prompt: `n${i}`, answer: `${i}` });

    const queue = repo.dueQueue({ now: '2026-12-01T10:00:00.000Z', newLimit: 2 });
    const states = queue.map((c) => c.state);
    expect(states.filter((s) => s === 'review')).toHaveLength(1);
    expect(states.filter((s) => s === 'new')).toHaveLength(2); // capped at newLimit

    const counts = repo.counts('2026-12-01T10:00:00.000Z');
    expect(counts.due).toBe(1);
    expect(counts.new).toBe(3);
  });
});

describe('suspend / bury (F1707)', () => {
  it('takes a card out of the queue when suspended', () => {
    const repo = cardsRepo(freshDb());
    const c = repo.create({ prompt: 'q', answer: 'a' });
    repo.review(c.id, RATING.Good, '2026-06-01T10:00:00.000Z');
    repo.setState(c.id, 'suspended');
    const queue = repo.dueQueue({ now: '2026-12-01T10:00:00.000Z' });
    expect(queue.find((x) => x.id === c.id)).toBeUndefined();
    expect(repo.counts('2026-12-01T10:00:00.000Z').suspended).toBe(1);
  });
});

describe('orphan handling (F1718)', () => {
  it('cards survive note deletion as orphans', () => {
    const db = freshDb();
    const repo = cardsRepo(db);
    const nb = notebooksRepo(db).create({ name: 'NB' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 'T', body: 'b' });
    const card = repo.create({ prompt: 'q', answer: 'a', noteId: note.id });
    expect(repo.forNote(note.id)).toHaveLength(1);

    notesRepo(db).trash(note.id);
    notesRepo(db).purgeTrashed();
    const orphan = repo.get(card.id)!;
    expect(orphan.noteId).toBeNull(); // ON DELETE SET NULL
    expect(repo.orphans().map((o) => o.id)).toContain(card.id);
  });
});
