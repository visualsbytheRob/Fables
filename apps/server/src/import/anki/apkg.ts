/**
 * Anki .apkg import/export (Epic 18, F1781–F1785).
 *
 * An .apkg is a ZIP wrapping a SQLite collection (`collection.anki21` or
 * `collection.anki2`) plus media files named by index with a `media` JSON map.
 * We reuse the hand-written ZIP reader/writer (no new deps); the SQLite database
 * is read via better-sqlite3 from a temp file.
 *
 * Scheduling translation (F1784): Anki stores an interval (`ivl`, days) and ease
 * `factor` (×1000). We map a reviewed card's interval to FSRS stability and its
 * ease to a difficulty (lower ease ⇒ higher difficulty), so resumed cards keep a
 * sensible schedule rather than resetting to new.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readZip } from '../lib/zip.js';
import { writeZip } from '../lib/zip-write.js';

const FIELD_SEP = '\x1f';

export interface AnkiCardImport {
  prompt: string;
  answer: string;
  kind: 'basic';
  /** FSRS stability in days, or null for an unseen card. */
  stability: number | null;
  /** FSRS difficulty 1–10, or null. */
  difficulty: number | null;
  /** Lifecycle: 'new' for unseen, 'review' for scheduled. */
  state: 'new' | 'review';
}

export interface ApkgParseResult {
  cards: AnkiCardImport[];
  /** Media filename → bytes (F1783). */
  media: Record<string, Buffer>;
}

/** Anki ease (×1000) → FSRS difficulty 1–10. Ease 2.5 ⇒ ~5; lower ease harder. */
function easeToDifficulty(factor: number): number {
  if (!factor || factor <= 0) return 5;
  const ease = factor / 1000; // typically 1.3–3.0
  // Map ease [1.3, 3.0] → difficulty [9, 1] (clamped).
  const d = 9 - ((ease - 1.3) / (3.0 - 1.3)) * 8;
  return Math.min(10, Math.max(1, Math.round(d * 10) / 10));
}

/** Parse an .apkg buffer into importable cards + media (F1781/F1783/F1784). */
export function parseApkg(bytes: Buffer): ApkgParseResult {
  const entries = readZip(bytes);
  const collection =
    entries.find((e) => e.name === 'collection.anki21') ??
    entries.find((e) => e.name === 'collection.anki2');
  if (!collection) throw new Error('not an .apkg: no collection database found');

  // Media map: the `media` entry is JSON of { "0": "image.png", ... }.
  const mediaEntry = entries.find((e) => e.name === 'media');
  const media: Record<string, Buffer> = {};
  if (mediaEntry) {
    try {
      const map = JSON.parse(mediaEntry.data.toString('utf8')) as Record<string, string>;
      for (const [index, name] of Object.entries(map)) {
        const file = entries.find((e) => e.name === index);
        if (file) media[name] = file.data;
      }
    } catch {
      // No / malformed media map — skip media.
    }
  }

  // Write the collection to a temp file and read it.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apkg-'));
  const dbPath = path.join(tmp, 'collection.sqlite');
  fs.writeFileSync(dbPath, collection.data);
  const cards: AnkiCardImport[] = [];
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const noteFlds = new Map<number, string>();
      for (const n of db.prepare('SELECT id, flds FROM notes').all() as {
        id: number;
        flds: string;
      }[]) {
        noteFlds.set(n.id, n.flds);
      }
      for (const c of db.prepare('SELECT nid, ivl, factor, type FROM cards').all() as {
        nid: number;
        ivl: number;
        factor: number;
        type: number;
      }[]) {
        const flds = noteFlds.get(c.nid);
        if (flds === undefined) continue;
        const parts = flds.split(FIELD_SEP);
        const prompt = (parts[0] ?? '').trim();
        const answer = parts.slice(1).join(' — ').trim() || prompt;
        if (prompt.length === 0) continue;
        // type 2 = review; ivl > 0 means it has a real interval (in days).
        const reviewed = c.type >= 2 && c.ivl > 0;
        cards.push({
          prompt,
          answer,
          kind: 'basic',
          stability: reviewed ? c.ivl : null,
          difficulty: reviewed ? easeToDifficulty(c.factor) : null,
          state: reviewed ? 'review' : 'new',
        });
      }
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { cards, media };
}

export interface ApkgExportCard {
  prompt: string;
  answer: string;
  stability?: number | null;
}

/**
 * Build a minimal .apkg from cards (F1785). The embedded collection uses the
 * Anki `notes`/`cards` table shape so our own importer round-trips it; a minimal
 * `col` row is included for closer Anki compatibility.
 */
export function exportApkg(cards: ApkgExportCard[]): Buffer {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apkg-out-'));
  const dbPath = path.join(tmp, 'collection.anki2');
  try {
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, models TEXT, decks TEXT, conf TEXT);
        CREATE TABLE notes (id INTEGER PRIMARY KEY, flds TEXT NOT NULL, sfld TEXT NOT NULL);
        CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER NOT NULL, ivl INTEGER NOT NULL DEFAULT 0, factor INTEGER NOT NULL DEFAULT 2500, type INTEGER NOT NULL DEFAULT 0);
      `);
      db.prepare(
        'INSERT INTO col (id, crt, mod, models, decks, conf) VALUES (1, ?, ?, ?, ?, ?)',
      ).run(Math.floor(Date.now() / 1000), Date.now(), '{}', '{}', '{}');
      const insNote = db.prepare('INSERT INTO notes (id, flds, sfld) VALUES (?, ?, ?)');
      const insCard = db.prepare(
        'INSERT INTO cards (id, nid, ivl, factor, type) VALUES (?, ?, ?, ?, ?)',
      );
      const tx = db.transaction(() => {
        cards.forEach((c, i) => {
          const nid = i + 1;
          insNote.run(nid, `${c.prompt}${FIELD_SEP}${c.answer}`, c.prompt);
          const ivl = c.stability != null && c.stability > 0 ? Math.round(c.stability) : 0;
          insCard.run(i + 1, nid, ivl, 2500, ivl > 0 ? 2 : 0);
        });
      });
      tx();
    } finally {
      db.close();
    }
    const collectionBytes = fs.readFileSync(dbPath);
    return writeZip([
      { name: 'collection.anki2', data: collectionBytes },
      { name: 'media', data: Buffer.from('{}', 'utf8') },
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
