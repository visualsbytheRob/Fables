import { isAppError } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { paginated, parsePagination } from '../api/envelope.js';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { lintQuery, parseFql } from '../fql/index.js';
import { exportQueryMarkdown, runFqlQuery } from '../services/query.js';
import { explainFqlQuery, runAggregateQuery } from '../services/query-v2.js';

const queryQuerySchema = z.object({ q: z.string().default('') });
const validateBodySchema = z.object({ q: z.string() });
const exportQuerySchema = z.object({
  q: z.string().default(''),
  format: z.enum(['markdown']).default('markdown'),
});
const explainQuerySchema = z.object({ q: z.string().default('') });
const lintBodySchema = z.object({ q: z.string() });
const aggregateBodySchema = z.object({
  q: z.string().default(''),
  groupBy: z.string().min(1).max(50).optional(),
  metrics: z
    .array(
      z.object({
        fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
        field: z.string().min(1).max(50).optional(),
        as: z.string().min(1).max(50),
      }),
    )
    .min(1)
    .max(20),
  computed: z
    .array(z.object({ as: z.string().min(1).max(50), expr: z.string().min(1).max(500) }))
    .max(20)
    .optional(),
  vars: z.record(z.string(), z.string()).optional(),
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
registerRoute({
  method: 'GET',
  path: '/query/explain',
  summary: 'EXPLAIN a query: static plan + compiled SQL (F1965)',
  query: explainQuerySchema,
});
registerRoute({
  method: 'POST',
  path: '/query/lint',
  summary: 'Lint a query with suggestions (F1968)',
  body: lintBodySchema,
});
registerRoute({
  method: 'POST',
  path: '/query/aggregate',
  summary: 'Aggregate query results with computed fields (F1961–F1963)',
  body: aggregateBodySchema,
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

  /** Static EXPLAIN: the plan + the parameterized SQL, no rows fetched (F1965). */
  app.get('/query/explain', async (request) => {
    const { q } = parseWith(explainQuerySchema, request.query, 'query');
    return { data: explainFqlQuery(q) };
  });

  /** Query linting with suggestions (F1968). Always 200 — findings carry severity. */
  app.post('/query/lint', async (request) => {
    const { q } = parseWith(lintBodySchema, request.body, 'body');
    return { data: { findings: lintQuery(q) } };
  });

  /** Aggregations + computed fields over the result set (F1961–F1963). */
  app.post('/query/aggregate', async (request) => {
    const body = parseWith(aggregateBodySchema, request.body, 'body');
    const result = runAggregateQuery(app.db, body.q, {
      spec: {
        ...(body.groupBy !== undefined ? { groupBy: body.groupBy } : {}),
        metrics: body.metrics.map((m) => ({
          fn: m.fn,
          as: m.as,
          ...(m.field !== undefined ? { field: m.field } : {}),
        })),
      },
      ...(body.computed !== undefined ? { computed: body.computed } : {}),
      ...(body.vars !== undefined ? { vars: body.vars } : {}),
    });
    return { data: result };
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
