import { isAppError } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { paginated, parsePagination } from '../api/envelope.js';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { parseFql } from '../fql/index.js';
import { exportQueryMarkdown, runFqlQuery } from '../services/query.js';

const queryQuerySchema = z.object({ q: z.string().default('') });
const validateBodySchema = z.object({ q: z.string() });
const exportQuerySchema = z.object({
  q: z.string().default(''),
  format: z.enum(['markdown']).default('markdown'),
});

registerRoute({
  method: 'GET',
  path: '/query',
  summary: 'Run an FQL query (paginated note results + warnings)',
  query: queryQuerySchema,
});
registerRoute({
  method: 'POST',
  path: '/query/validate',
  summary: 'Lint an FQL query without running it',
  body: validateBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/query/export',
  summary: 'Export FQL query results as a markdown table',
  query: exportQuerySchema,
});

export const queryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/query', async (request) => {
    const pagination = parsePagination(request.query);
    const { q } = parseWith(queryQuerySchema, request.query, 'query');
    const { notes, warnings } = runFqlQuery(app.db, q, {
      fetch: pagination.limit + 1,
      cursor: pagination.cursor,
    });
    return { ...paginated(notes, pagination), warnings };
  });

  /** Editor linting for the query bar / embed blocks (F278/F283 server half). */
  app.post('/query/validate', async (request) => {
    const { q } = parseWith(validateBodySchema, request.body, 'body');
    try {
      const { warnings } = parseFql(q);
      return { data: { valid: true, warnings } };
    } catch (error) {
      if (isAppError(error) && error.code === 'VALIDATION') {
        return {
          data: {
            valid: false,
            warnings: [],
            error: { message: error.message, position: error.details?.position ?? null },
          },
        };
      }
      throw error;
    }
  });

  app.get('/query/export', async (request, reply) => {
    const { q } = parseWith(exportQuerySchema, request.query, 'query');
    const markdown = exportQueryMarkdown(app.db, q);
    return reply
      .header('content-type', 'text/markdown; charset=utf-8')
      .header('content-disposition', 'attachment; filename="query-results.md"')
      .send(markdown);
  });
};
