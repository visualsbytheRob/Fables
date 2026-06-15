/**
 * Card authoring route tests (Epic 18, F1713/F1717/F1719).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
});

afterAll(async () => {
  await app.close();
});

describe('POST /cards/extract (F1713)', () => {
  it('previews cards from text without persisting', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cards/extract',
      payload: {
        text: 'Q: What is the capital of France?\nA: Paris\n\nThe {{c1::sun}} is a star.',
      },
    });
    expect(res.statusCode).toBe(200);
    const cards = (res.json() as { data: { cards: { kind: string }[] } }).data.cards;
    expect(cards.some((c) => c.kind === 'qa')).toBe(true);
    expect(cards.some((c) => c.kind === 'cloze')).toBe(true);
  });
});

describe('POST /notes/:id/cards/sync (F1717)', () => {
  it('extracts cards from a note body and reconciles them', async () => {
    const nb = notebooksRepo(app.db).create({ name: 'Study' });
    const note = notesRepo(app.db).create({
      notebookId: nb.id,
      title: 'Biology',
      body: 'Q: Powerhouse of the cell?\nA: Mitochondria',
    });

    const sync = await app.inject({
      method: 'POST',
      url: `/api/v1/notes/${note.id}/cards/sync`,
      payload: {},
    });
    expect(sync.statusCode).toBe(200);
    const data = (sync.json() as { data: { added: number; cards: unknown[] } }).data;
    expect(data.added).toBeGreaterThanOrEqual(1);
    expect(data.cards.length).toBe(data.added);
  });

  it('404s for an unknown note', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notes/note_nope/cards/sync',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /cards browse (F1719)', () => {
  it('filters cards by state and text', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/cards',
      payload: { prompt: 'browsable widget question', answer: 'widget answer' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cards?state=new&q=widget',
    });
    expect(res.statusCode).toBe(200);
    const cards = (res.json() as { data: { cards: { prompt: string; answer: string }[] } }).data
      .cards;
    expect(cards.some((c) => c.prompt.includes('widget'))).toBe(true);
    expect(cards.every((c) => c.prompt.includes('widget') || c.answer.includes('widget'))).toBe(
      true,
    );
  });
});
