import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { insightsRepo } from '../db/repos/insights.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { createNote } from '../services/notes.js';
import type { NotebookId } from '@fables/core';

/**
 * Insights routes (F791–F800): pure aggregation over existing tables.
 * No new deps.
 */

registerRoute({
  method: 'GET',
  path: '/insights/overview',
  summary: 'Vault stats: notes, notebooks, entities, stories, links, orphans, wordsTotal',
});
registerRoute({
  method: 'GET',
  path: '/insights/growth',
  summary: 'Per-day notes/links/words between from and to dates',
});
registerRoute({
  method: 'GET',
  path: '/insights/streaks',
  summary: 'Current + longest daily-note streak and 365-day heatmap',
});
registerRoute({
  method: 'GET',
  path: '/insights/stale',
  summary: 'High-degree notes untouched 14+ days',
});
registerRoute({
  method: 'GET',
  path: '/insights/suggested-links',
  summary: 'Top unlinked-mention pairs',
});
registerRoute({
  method: 'GET',
  path: '/insights/reading',
  summary: 'Story plays, turns, completions, top scenes',
});
registerRoute({
  method: 'GET',
  path: '/insights/dead-ends',
  summary: 'Orphan notes and broken links',
});
registerRoute({
  method: 'GET',
  path: '/insights/health',
  summary: '0–100 vault health score with actionable checklist',
});
registerRoute({
  method: 'POST',
  path: '/insights/digest',
  summary: 'Create a markdown weekly-digest note',
});

const growthQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .optional(),
});

const staleQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const suggestedLinksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const digestBodySchema = z.object({
  notebookId: z.string().min(1).optional(),
});

/** Returns YYYY-MM-DD for N days ago. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const insightsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/insights/overview', async () => {
    return { data: insightsRepo(app.db).overview() };
  });

  app.get('/insights/growth', async (request) => {
    const { from, to } = parseWith(growthQuerySchema, request.query, 'query');
    const fromDate = from ?? daysAgo(30);
    const toDate = to ?? today();
    return { data: insightsRepo(app.db).growth(fromDate, toDate) };
  });

  app.get('/insights/streaks', async () => {
    return { data: insightsRepo(app.db).streaks() };
  });

  app.get('/insights/stale', async (request) => {
    const { limit } = parseWith(staleQuerySchema, request.query, 'query');
    return { data: insightsRepo(app.db).stale(limit) };
  });

  app.get('/insights/suggested-links', async (request) => {
    const { limit } = parseWith(suggestedLinksQuerySchema, request.query, 'query');
    return { data: insightsRepo(app.db).suggestedLinks(limit) };
  });

  app.get('/insights/reading', async () => {
    return { data: insightsRepo(app.db).reading() };
  });

  app.get('/insights/dead-ends', async () => {
    return { data: insightsRepo(app.db).deadEnds() };
  });

  app.get('/insights/health', async () => {
    return { data: insightsRepo(app.db).health() };
  });

  /**
   * POST /insights/digest
   * Creates a markdown note summarizing the vault state for the past week.
   * The note is placed in the first available notebook (or the one specified
   * by notebookId in the body).
   */
  app.post('/insights/digest', async (request, reply) => {
    const body = parseWith(digestBodySchema, request.body, 'body');
    const db = app.db;
    const repo = insightsRepo(db);
    const overview = repo.overview();
    const growth = repo.growth(daysAgo(7), today());
    const streak = repo.streaks();
    const stale = repo.stale(5);
    const suggested = repo.suggestedLinks(5);
    const health = repo.health();

    // Pick target notebook
    let notebookId = body.notebookId;
    if (!notebookId) {
      const notebooks = notebooksRepo(db).list();
      if (notebooks.length === 0) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION',
            message: 'no notebooks exist — create one first',
            details: null,
          },
        });
      }
      notebookId = notebooks[0]!.id;
    }

    const weekNotes = growth.reduce((a, g) => a + g.notes, 0);
    const weekWords = growth.reduce((a, g) => a + g.words, 0);
    const weekLinks = growth.reduce((a, g) => a + g.links, 0);

    const staleSection =
      stale.length > 0
        ? stale
            .map((s) => `- [[${s.title}]] (${s.linkDegree} links, last touched ${s.updatedAt.slice(0, 10)})`)
            .join('\n')
        : '_none_';

    const suggestedSection =
      suggested.length > 0
        ? suggested
            .map((s) => `- [[${s.sourceTitle}]] → [[${s.targetTitle}]] (${s.mentionCount} mentions)`)
            .join('\n')
        : '_none_';

    const checklistSection = health.checklist
      .map((c) => `- [${c.ok ? 'x' : ' '}] ${c.label}${c.detail ? ` — ${c.detail}` : ''}`)
      .join('\n');

    const digestBody = `# Weekly Digest — ${today()}

## Stats

| Metric | Total |
|--------|-------|
| Notes | ${overview.notes} |
| Words | ${overview.wordsTotal} |
| Links | ${overview.links} |
| Orphans | ${overview.orphans} |
| Entities | ${overview.entities} |
| Stories | ${overview.stories} |

## This Week

- **${weekNotes}** new notes
- **${weekWords}** words written
- **${weekLinks}** links created

## Streaks

- Current streak: **${streak.current}** days
- Longest streak: **${streak.longest}** days

## Vault Health: ${health.score}/100

${checklistSection}

## Stale High-Degree Notes

${staleSection}

## Suggested Links

${suggestedSection}
`;

    const note = createNote(db, {
      notebookId: notebookId as NotebookId,
      title: `Weekly Digest — ${today()}`,
      body: digestBody,
    });

    reply.status(201);
    return { data: note };
  });
};
