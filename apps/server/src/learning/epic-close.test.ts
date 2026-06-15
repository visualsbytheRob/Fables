/**
 * Epic 18 close — full learning loop (F1791 e2e, F1792 perf, F1797 regression).
 *
 * Proves the whole spaced-repetition backend composes: a note's content becomes
 * cards, the cards are reviewed through FSRS, the reviews feed insights + a
 * review fable, and a session is built fast enough for a phone.
 */

import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { cardsRepo } from '../db/repos/cards.js';
import { learningInsightsRepo } from '../db/repos/learning-insights.js';
import { extractCards } from './extract.js';
import { generateReviewStory } from './story-gen.js';
import { spaceSiblings, applyCatchUp } from './edge.js';
import { RATING } from './fsrs.js';
import { compile } from '@fables/forge-dsl';

function fresh(): Db {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

describe('full learning loop (F1791)', () => {
  it('note → cards → reviews → retention → review fable', () => {
    const db = fresh();
    const cards = cardsRepo(db);
    const insights = learningInsightsRepo(db);

    // 1. A note with learnable content.
    const nb = notebooksRepo(db).create({ name: 'Biology' });
    const note = notesRepo(db).create({
      notebookId: nb.id,
      title: 'Cell',
      body: 'Q: Powerhouse of the cell?\nA: Mitochondria\n\nThe {{c1::nucleus}} holds DNA.',
    });

    // 2. Sync cards from the note.
    const sync = cards.syncForNote(note.id, extractCards(note.body));
    expect(sync.added).toBeGreaterThanOrEqual(2);
    const mine = cards.forNote(note.id);

    // 3. Review every card a couple of times.
    let day = 0;
    for (const c of mine) {
      cards.review(c.id, RATING.Good, `2026-06-${String(15 + day).padStart(2, '0')}T10:00:00.000Z`);
      cards.review(c.id, RATING.Good, `2026-06-${String(20 + day).padStart(2, '0')}T10:00:00.000Z`);
      day++;
    }

    // 4. Insights reflect the reviews.
    const retention = insights.trueRetention();
    expect(retention.reviews).toBeGreaterThan(0);
    expect(retention.retention).toBe(1); // all Good
    expect(insights.coverage().notesWithCards).toBe(1);

    // 5. A review fable from the cards still compiles.
    const story = generateReviewStory(
      mine.map((c) => ({ id: c.id, prompt: c.prompt, answer: c.answer })),
    );
    expect(compile(story.source).ok).toBe(true);
  });
});

describe('phone-session performance (F1792)', () => {
  it('builds a polished session over many cards quickly', () => {
    const db = fresh();
    const cards = cardsRepo(db);
    // 2,000 brand-new cards.
    for (let i = 0; i < 2000; i++) cards.create({ prompt: `q${i}`, answer: `a${i}` });

    const start = Date.now();
    const raw = cards.dueQueue({ now: '2026-12-01T10:00:00.000Z', limit: 500, newLimit: 200 });
    const { session } = applyCatchUp(raw, { dueCap: 500, newCap: 200 });
    const spaced = spaceSiblings(session);
    const elapsed = Date.now() - start;

    expect(spaced.length).toBeGreaterThan(0);
    // A session build must feel instant on a phone.
    expect(elapsed).toBeLessThan(1000);
  });
});
