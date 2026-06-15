/**
 * Card live-link sync tests (F1717) — reconcile a note's auto-cards on edit.
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../connection.js';
import { migrate } from '../migrate.js';
import { cardsRepo } from './cards.js';
import { notesRepo } from './notes.js';
import { notebooksRepo } from './notebooks.js';
import { extractCards } from '../../learning/extract.js';
import { RATING } from '../../learning/fsrs.js';

/** A repo plus a real note id to bind cards to (the FK requires it). */
function freshRepo() {
  const db = openDb(':memory:');
  migrate(db);
  const nb = notebooksRepo(db).create({ name: 'NB' });
  const noteId = (body: string) => notesRepo(db).create({ notebookId: nb.id, title: 'T', body }).id;
  return { repo: cardsRepo(db), noteId };
}

describe('syncForNote (F1717)', () => {
  it('adds cards on first sync', () => {
    const { repo, noteId } = freshRepo();
    const body = 'Q: What is 2+2?\nA: 4\n\nThe {{c1::mitochondria}} is the powerhouse.';
    const id = noteId(body);
    const res = repo.syncForNote(id, extractCards(body));
    expect(res.added).toBeGreaterThanOrEqual(2);
    expect(repo.forNote(id).length).toBe(res.added);
  });

  it('updates a changed answer in place, preserving identity', () => {
    const { repo, noteId } = freshRepo();
    const id = noteId('Q: Capital?\nA: Paris');
    repo.syncForNote(id, extractCards('Q: Capital?\nA: Paris'));
    const before = repo.forNote(id);
    const cardId = before[0]!.id;

    const res = repo.syncForNote(id, extractCards('Q: Capital?\nA: Paris, France'));
    expect(res.updated).toBe(1);
    expect(res.added).toBe(0);
    const after = repo.forNote(id);
    expect(after[0]!.id).toBe(cardId); // same card, updated
    expect(after[0]!.answer).toBe('Paris, France');
  });

  it('removes vanished new cards but keeps reviewed ones', () => {
    const { repo, noteId } = freshRepo();
    const id = noteId('Q: One?\nA: 1\n\nQ: Two?\nA: 2');
    repo.syncForNote(id, extractCards('Q: One?\nA: 1\n\nQ: Two?\nA: 2'));
    const cards = repo.forNote(id);
    expect(cards).toHaveLength(2);
    // Review the first card so it has history.
    repo.review(cards[0]!.id, RATING.Good, '2026-06-15T10:00:00.000Z');

    // Now the note only contains the (reviewed) first Q&A; second vanished.
    const res = repo.syncForNote(id, extractCards('Q: One?\nA: 1'));
    expect(res.removed).toBe(1); // the never-reviewed second card
    const remaining = repo.forNote(id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(cards[0]!.id); // reviewed card survives
  });
});
