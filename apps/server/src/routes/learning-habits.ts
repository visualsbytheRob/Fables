/**
 * Habit + notification routes (Epic 18, F1772–F1778).
 *
 *  GET  /learning/habits/best-time   — best review hour from history (F1773)
 *  GET  /learning/habits/reminder    — a reminder line + due count, quiet-hours
 *                                      and quiet-when-nothing-due aware (F1772/
 *                                      F1776/F1777)
 *  POST /learning/habits/digest      — weekly learning digest, optionally saved
 *                                      as a note (F1775)
 *
 * The actual local notifications, badge, and deep-links are the PWA layer; this
 * supplies the timing, copy, and content they deliver.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { NotebookId } from '@fables/core';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { cardsRepo } from '../db/repos/cards.js';
import { notesRepo } from '../db/repos/notes.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { learningSettingsRepo } from '../db/repos/learning-settings.js';
import { learningInsightsRepo } from '../db/repos/learning-insights.js';
import { bestReviewHour, pickReminder, weeklyDigest, inQuietHours } from '../learning/habits.js';

registerRoute({
  method: 'GET',
  path: '/learning/habits/best-time',
  summary: 'Best review hour (F1773)',
});
registerRoute({
  method: 'GET',
  path: '/learning/habits/reminder',
  summary: 'Reminder copy (F1777)',
});
registerRoute({
  method: 'POST',
  path: '/learning/habits/digest',
  summary: 'Weekly digest note (F1775)',
});

export const learningHabitsRoutes: FastifyPluginAsync = async (app) => {
  const cards = cardsRepo(app.db);
  const notes = notesRepo(app.db);
  const notebooks = notebooksRepo(app.db);
  const settings = learningSettingsRepo(app.db);
  const insights = learningInsightsRepo(app.db);
  const nowIso = () => new Date().toISOString();

  app.get('/learning/habits/best-time', async () => {
    const rows = app.db
      .prepare('SELECT reviewed_at FROM review_log ORDER BY reviewed_at DESC LIMIT 5000')
      .all() as { reviewed_at: string }[];
    return { data: { best: bestReviewHour(rows.map((r) => r.reviewed_at)) } };
  });

  app.get('/learning/habits/reminder', async (request) => {
    const q = parseWith(
      z.object({ now: z.string().datetime().optional() }),
      request.query,
      'query',
    );
    const now = q.now ?? nowIso();
    const cfg = settings.get();

    // Respect quiet hours + vacation: no reminder.
    if (inQuietHours(now, cfg.quietStart, cfg.quietEnd) || settings.onVacation(now)) {
      return { data: { reminder: null, reason: 'quiet' } };
    }
    const counts = cards.counts(now);
    const streak = insights.streak(now).current;
    const reminder = pickReminder(counts.due + counts.new, streak, new Date(now).getTime());
    return { data: { reminder, dueCount: counts.due, newCount: counts.new, streak } };
  });

  app.post('/learning/habits/digest', async (request) => {
    const body = parseWith(
      z.object({
        now: z.string().datetime().optional(),
        save: z.boolean().optional(),
        notebookId: z.string().min(1).optional(),
      }),
      request.body,
      'body',
    );
    const now = body.now ?? nowIso();
    const weekAgo = new Date(new Date(now).getTime() - 7 * 86_400_000).toISOString();
    const retention = insights.trueRetention(weekAgo);
    const heatmap = insights.heatmap(weekAgo);
    const reviews = heatmap.reduce((n, d) => n + d.count, 0);
    const counts = cards.counts(now);
    const forecast = insights.forecast(now, 2);

    const markdown = weeklyDigest(
      {
        reviews,
        retention: retention.retention,
        streak: insights.streak(now).current,
        newCards: counts.new,
        dueTomorrow: forecast[1]?.count ?? 0,
      },
      now,
    );

    let savedNoteId: string | null = null;
    if (body.save) {
      // File the digest as a note in the given notebook (or the first one).
      const nbId = body.notebookId ?? notebooks.list()[0]?.id;
      if (nbId) {
        const note = notes.create({
          notebookId: nbId as NotebookId,
          title: `Weekly learning digest — ${now.slice(0, 10)}`,
          body: markdown,
        });
        savedNoteId = note.id;
      }
    }
    return { data: { markdown, savedNoteId } };
  });
};
