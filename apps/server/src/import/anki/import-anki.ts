/**
 * Anki .apkg → Fables cards import (Epic 18, F1781/F1784).
 *
 * Parses an .apkg and creates cards, translating each reviewed card's Anki
 * interval/ease into FSRS stability/difficulty + a future due date so resumed
 * cards keep their schedule.
 */

import type { Db } from '../../db/connection.js';
import { cardsRepo } from '../../db/repos/cards.js';
import { parseApkg } from './apkg.js';

const MS_PER_DAY = 86_400_000;

export interface AnkiImportResult {
  imported: number;
  withSchedule: number;
  media: number;
}

export function importApkg(db: Db, bytes: Buffer, now = new Date()): AnkiImportResult {
  const parsed = parseApkg(bytes);
  const cards = cardsRepo(db);
  let withSchedule = 0;
  const update = db.prepare(
    `UPDATE cards SET state = 'review', stability = ?, difficulty = ?, due = ?, last_review = ?, reps = 1
     WHERE id = ?`,
  );
  const tx = db.transaction(() => {
    for (const c of parsed.cards) {
      const card = cards.create({ prompt: c.prompt, answer: c.answer, kind: c.kind });
      if (c.state === 'review' && c.stability !== null) {
        const due = new Date(now.getTime() + c.stability * MS_PER_DAY).toISOString();
        update.run(c.stability, c.difficulty, due, now.toISOString(), card.id);
        withSchedule++;
      }
    }
  });
  tx();
  return {
    imported: parsed.cards.length,
    withSchedule,
    media: Object.keys(parsed.media).length,
  };
}
