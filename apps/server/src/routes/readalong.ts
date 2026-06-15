/**
 * Read-along routes (Epic 17, F1641–F1650).
 *
 *  POST /readalong/align         — word/sentence time alignment for any text
 *                                  (stories or plain notes, F1646)
 *
 * Highlighting, auto-scroll, tap-to-seek, karaoke styling, and reading-practice
 * capture are the web player's; this returns the timing model they drive. When
 * the caller has engine word boundaries (F1642) it passes them; otherwise the
 * proportional fallback (F1647) is used.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { alignmentFromBoundaries, estimateAlignment } from '../audio/readalong/align.js';

registerRoute({
  method: 'POST',
  path: '/readalong/align',
  summary: 'Word/sentence alignment for read-along (F1642/F1647)',
});

const alignBody = z.object({
  text: z.string().min(1).max(200_000),
  /** Known total audio duration; required for the proportional fallback. */
  totalMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000),
  /** Engine-reported per-word boundaries, when available (F1642). */
  boundaries: z
    .array(
      z.object({
        index: z.number().int().min(0),
        startMs: z.number().int().min(0),
        endMs: z.number().int().min(0),
      }),
    )
    .max(100_000)
    .optional(),
});

export const readalongRoutes: FastifyPluginAsync = async (app) => {
  app.post('/readalong/align', async (request) => {
    const body = parseWith(alignBody, request.body, 'body');
    const alignment =
      body.boundaries && body.boundaries.length > 0
        ? alignmentFromBoundaries(body.text, body.boundaries)
        : estimateAlignment(body.text, body.totalMs);
    return {
      data: {
        words: alignment.words,
        sentences: alignment.sentences,
        totalMs: alignment.totalMs,
        source: body.boundaries && body.boundaries.length > 0 ? 'engine' : 'estimated',
      },
    };
  });
};
