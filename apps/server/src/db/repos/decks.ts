/**
 * Decks repository (Epic 18, F1741–F1748).
 *
 * A deck is a saved card filter + per-deck scheduler settings (migration 036).
 * Membership is dynamic — `members()` evaluates the filter against the cards
 * table via `cardsRepo.browse`, so a deck is always live. `dashboard()` gives the
 * due count + an N-day workload forecast (F1743); `.fdeck` export/import snapshot
 * a deck and its cards for sharing (F1746).
 */

import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';
import { cardsRepo, type BrowseFilters, type Card } from './cards.js';

export interface DeckSettings {
  /** FSRS target retention for this deck, 0.7–0.99. */
  requestRetention?: number | undefined;
  /** New cards per session for this deck. */
  newLimit?: number | undefined;
  /** Max interval cap in days. */
  maxIntervalDays?: number | undefined;
}

/** The filter persisted on a deck — a subset of BrowseFilters (no paging). */
export type DeckFilter = Omit<BrowseFilters, 'limit' | 'offset'>;

export interface Deck {
  id: string;
  name: string;
  filter: DeckFilter;
  settings: DeckSettings;
  createdAt: string;
  updatedAt: string;
}

interface DeckRow {
  id: string;
  name: string;
  filter: string;
  settings: string;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(s: string, fallback: T): T {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

const toDeck = (r: DeckRow): Deck => ({
  id: r.id,
  name: r.name,
  filter: parseJson<DeckFilter>(r.filter, {}),
  settings: parseJson<DeckSettings>(r.settings, {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const newDeckId = (): string => `deck_${crypto.randomUUID()}`;
const MS_PER_DAY = 86_400_000;

export interface DeckInput {
  name: string;
  filter?: DeckFilter;
  settings?: DeckSettings;
}

export function decksRepo(db: Db) {
  const cards = cardsRepo(db);

  return {
    create(input: DeckInput): Deck {
      const now = nowIso();
      const deck: Deck = {
        id: newDeckId(),
        name: input.name,
        filter: input.filter ?? {},
        settings: input.settings ?? {},
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        'INSERT INTO decks (id, name, filter, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        deck.id,
        deck.name,
        JSON.stringify(deck.filter),
        JSON.stringify(deck.settings),
        now,
        now,
      );
      return deck;
    },

    get(id: string): Deck | null {
      const row = db.prepare('SELECT * FROM decks WHERE id = ?').get(id) as DeckRow | undefined;
      return row ? toDeck(row) : null;
    },

    list(): Deck[] {
      return (db.prepare('SELECT * FROM decks ORDER BY name').all() as DeckRow[]).map(toDeck);
    },

    update(
      id: string,
      patch: { name?: string; filter?: DeckFilter; settings?: DeckSettings },
    ): Deck | null {
      const cur = this.get(id);
      if (!cur) return null;
      const next: Deck = {
        ...cur,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.filter !== undefined ? { filter: patch.filter } : {}),
        ...(patch.settings !== undefined ? { settings: patch.settings } : {}),
        updatedAt: nowIso(),
      };
      db.prepare(
        'UPDATE decks SET name = ?, filter = ?, settings = ?, updated_at = ? WHERE id = ?',
      ).run(
        next.name,
        JSON.stringify(next.filter),
        JSON.stringify(next.settings),
        next.updatedAt,
        id,
      );
      return next;
    },

    remove(id: string): boolean {
      return db.prepare('DELETE FROM decks WHERE id = ?').run(id).changes > 0;
    },

    /** Cards currently matching the deck filter (F1741 dynamic membership). */
    members(id: string, opts: { limit?: number; offset?: number } = {}): Card[] {
      const deck = this.get(id);
      if (!deck) return [];
      return cards.browse({
        ...deck.filter,
        ...(opts.limit !== undefined ? { limit: opts.limit } : { limit: 10_000 }),
        ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
      });
    },

    /** Due count + an N-day workload forecast for a deck (F1743). */
    dashboard(
      id: string,
      now = nowIso(),
      days = 14,
    ): {
      total: number;
      due: number;
      newCards: number;
      forecast: { day: number; count: number }[];
    } {
      const all = this.members(id);
      const nowMs = new Date(now).getTime();
      let due = 0;
      let newCards = 0;
      const forecast = Array.from({ length: days }, (_, d) => ({ day: d, count: 0 }));
      for (const c of all) {
        if (c.state === 'new') {
          newCards++;
          continue;
        }
        if (c.due === null) continue;
        const offset = Math.floor((new Date(c.due).getTime() - nowMs) / MS_PER_DAY);
        if (offset <= 0) due++;
        const bucket = Math.max(0, offset);
        if (bucket < days) forecast[bucket]!.count++;
      }
      return { total: all.length, due, newCards, forecast };
    },

    /** Snapshot a deck + its current cards for sharing (.fdeck, F1746). */
    exportDeck(id: string): { format: 'fdeck'; version: 1; deck: Deck; cards: Card[] } | null {
      const deck = this.get(id);
      if (!deck) return null;
      return { format: 'fdeck', version: 1, deck, cards: this.members(id) };
    },

    /** Import a .fdeck snapshot: recreate the deck + its cards (F1746). */
    importDeck(snapshot: {
      deck: { name: string; filter?: DeckFilter | undefined; settings?: DeckSettings | undefined };
      cards: { prompt: string; answer: string; kind?: string | undefined }[];
    }): Deck {
      const deck = this.create({
        name: snapshot.deck.name,
        ...(snapshot.deck.filter !== undefined ? { filter: snapshot.deck.filter } : {}),
        ...(snapshot.deck.settings !== undefined ? { settings: snapshot.deck.settings } : {}),
      });
      for (const c of snapshot.cards) {
        cards.create({
          prompt: c.prompt,
          answer: c.answer,
          ...(c.kind !== undefined ? { kind: c.kind } : {}),
        });
      }
      return deck;
    },
  };
}

export type DecksRepo = ReturnType<typeof decksRepo>;
