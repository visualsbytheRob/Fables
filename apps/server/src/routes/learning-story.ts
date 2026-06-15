/**
 * Story-driven learning routes (Epic 18, F1731–F1740).
 *
 *  POST /review/story          — generate a Fable Forge "review fable" from the
 *                                current due cards (review disguised as a story,
 *                                F1731/F1732)
 *  POST /review/mastery        — mastery gate: is a set of cards retained above
 *                                a threshold right now? (F1733)
 *  POST /stories/:id/cards/sync — create cards from a story's source text (F1735)
 *
 * The generator output is guaranteed-compilable Forge (learning/story-gen.ts);
 * the player drives review through normal story playback + /cards/:id/review.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { StoryId } from '@fables/core';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { cardsRepo, type Card } from '../db/repos/cards.js';
import { storiesRepo } from '../db/repos/stories.js';
import { extractCards } from '../learning/extract.js';
import {
  generateReviewStory,
  masteryGate,
  cardRetrievability,
  type ReviewCardInput,
} from '../learning/story-gen.js';

registerRoute({
  method: 'POST',
  path: '/review/story',
  summary: 'Generate a review fable (F1732)',
});
registerRoute({ method: 'POST', path: '/review/mastery', summary: 'Mastery gate check (F1733)' });
registerRoute({
  method: 'POST',
  path: '/stories/:id/cards/sync',
  summary: 'Create cards from story source (F1735)',
});

const toReviewInput = (c: Card): ReviewCardInput => ({
  id: c.id,
  prompt: c.prompt,
  answer: c.answer,
  stability: c.stability,
  lastReview: c.lastReview,
});

const storyBody = z.object({
  now: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  newLimit: z.coerce.number().int().min(0).max(200).optional(),
  title: z.string().max(200).optional(),
  intro: z.string().max(2000).optional(),
});

const masteryBody = z.object({
  cardIds: z.array(z.string().min(1)).min(1).max(2000),
  threshold: z.number().min(0).max(1).optional(),
  now: z.string().datetime().optional(),
});

export const learningStoryRoutes: FastifyPluginAsync = async (app) => {
  const cards = cardsRepo(app.db);
  const stories = storiesRepo(app.db);

  app.post('/review/story', async (request) => {
    const body = parseWith(storyBody, request.body, 'body');
    const due = cards
      .dueQueue({
        ...(body.now !== undefined ? { now: body.now } : {}),
        ...(body.limit !== undefined ? { limit: body.limit } : {}),
        ...(body.newLimit !== undefined ? { newLimit: body.newLimit } : {}),
      })
      .map(toReviewInput);
    const story = generateReviewStory(due, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.intro !== undefined ? { intro: body.intro } : {}),
    });
    return { data: { ...story, cardCount: due.length } };
  });

  app.post('/review/mastery', async (request) => {
    const body = parseWith(masteryBody, request.body, 'body');
    const threshold = body.threshold ?? 0.9;
    const selected = body.cardIds
      .map((id) => cards.get(id))
      .filter((c): c is Card => c !== null)
      .map(toReviewInput);
    const mastered = masteryGate(selected, threshold, body.now);
    const retention = selected.map((c) => ({
      id: c.id,
      retrievability: cardRetrievability(c, body.now),
    }));
    return { data: { mastered, threshold, retention } };
  });

  app.post('/stories/:id/cards/sync', async (request) => {
    const { id } = parseWith(z.object({ id: z.string().min(1) }), request.params, 'params');
    stories.mustGet(id as StoryId);
    const source = stories
      .listFiles(id as StoryId)
      .map((f) => f.source)
      .join('\n\n');
    // Story cards aren't bound to a note; they're created standalone (F1735).
    const extracted = extractCards(source);
    const created = extracted.map((e) =>
      cards.create({
        prompt: e.prompt,
        answer: e.answer,
        kind: e.kind,
        blockRef: `story:${id}:${e.blockRef}`,
      }),
    );
    return { data: { created: created.length, cards: created } };
  });
};
