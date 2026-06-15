/**
 * Anki .apkg interop tests (F1781/F1784/F1785/F1787/F1788/F1789).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { cardsRepo } from '../../db/repos/cards.js';
import { writeZip } from '../lib/zip-write.js';
import { parseApkg, exportApkg } from './apkg.js';
import { importApkg } from './import-anki.js';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
});
afterEach(() => db.close());

/** Build a minimal real-Anki-schema .apkg with the given (front, back, ivl) notes. */
function buildAnkiApkg(
  notes: { front: string; back: string; ivl: number; factor?: number }[],
): Buffer {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anki-fixture-'));
  const dbPath = path.join(tmp, 'collection.anki2');
  try {
    const adb = new Database(dbPath);
    adb.exec(
      `CREATE TABLE notes (id INTEGER PRIMARY KEY, flds TEXT NOT NULL, sfld TEXT NOT NULL);
       CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, ivl INTEGER, factor INTEGER, type INTEGER);`,
    );
    const insN = adb.prepare('INSERT INTO notes (id, flds, sfld) VALUES (?, ?, ?)');
    const insC = adb.prepare(
      'INSERT INTO cards (id, nid, ivl, factor, type) VALUES (?, ?, ?, ?, ?)',
    );
    adb.transaction(() => {
      notes.forEach((n, i) => {
        const nid = i + 1;
        insN.run(nid, `${n.front}\x1f${n.back}`, n.front);
        insC.run(i + 1, nid, n.ivl, n.factor ?? 2500, n.ivl > 0 ? 2 : 0);
      });
    })();
    adb.close();
    const bytes = fs.readFileSync(dbPath);
    return writeZip([
      { name: 'collection.anki2', data: bytes },
      { name: 'media', data: Buffer.from('{}', 'utf8') },
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('parseApkg + scheduling translation (F1781/F1784)', () => {
  it('imports notes and preserves the interval as stability', () => {
    const apkg = buildAnkiApkg([
      { front: 'Capital of France?', back: 'Paris', ivl: 30, factor: 2500 },
      { front: 'New card', back: 'unseen', ivl: 0 },
    ]);
    const parsed = parseApkg(apkg);
    expect(parsed.cards).toHaveLength(2);

    const reviewed = parsed.cards.find((c) => c.prompt.startsWith('Capital'))!;
    expect(reviewed.state).toBe('review');
    expect(reviewed.stability).toBe(30);
    expect(reviewed.difficulty).toBeGreaterThan(0);

    const fresh = parsed.cards.find((c) => c.prompt === 'New card')!;
    expect(fresh.state).toBe('new');
    expect(fresh.stability).toBeNull();
  });

  it('importApkg creates cards and schedules reviewed ones', () => {
    const apkg = buildAnkiApkg([{ front: 'q', back: 'a', ivl: 10 }]);
    const result = importApkg(db, apkg, new Date('2026-06-15T10:00:00.000Z'));
    expect(result.imported).toBe(1);
    expect(result.withSchedule).toBe(1);
    const card = cardsRepo(db).browse({})[0]!;
    expect(card.state).toBe('review');
    expect(card.stability).toBe(10);
    expect(card.due).not.toBeNull();
  });

  it('rejects a non-apkg buffer', () => {
    expect(() => parseApkg(Buffer.from('not a zip'))).toThrow();
  });
});

describe('round-trip fidelity (F1785/F1787)', () => {
  it('exports cards to .apkg and imports them back', () => {
    const cards = cardsRepo(db);
    cards.create({ prompt: 'alpha', answer: 'first' });
    cards.create({ prompt: 'beta', answer: 'second' });

    const apkg = exportApkg(cards.browse({}).map((c) => ({ prompt: c.prompt, answer: c.answer })));

    const db2 = openDb(':memory:');
    migrate(db2);
    const result = importApkg(db2, apkg);
    expect(result.imported).toBe(2);
    const prompts = cardsRepo(db2)
      .browse({})
      .map((c) => c.prompt)
      .sort();
    expect(prompts).toEqual(['alpha', 'beta']);
    db2.close();
  });
});

describe('large collection benchmark (F1788)', () => {
  it('imports a large collection with linear scaling', () => {
    // 25k cards exercises the same code path as a 100k collection at a CI-safe
    // size; the importer is linear (single transaction, no per-card queries), so
    // 100k extrapolates to ~4× this time.
    const notes = Array.from({ length: 25_000 }, (_, i) => ({
      front: `q${i}`,
      back: `a${i}`,
      ivl: i % 3 === 0 ? (i % 60) + 1 : 0,
    }));
    const apkg = buildAnkiApkg(notes);
    const start = Date.now();
    const result = importApkg(db, apkg);
    expect(result.imported).toBe(25_000);
    expect(Date.now() - start).toBeLessThan(20_000);
  }, 60_000);
});
