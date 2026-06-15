/**
 * AI runtime depth routes (F1305–F1319).
 *
 *  POST /ai/stream                 — SSE token stream of a completion (F1305)
 *  GET  /ai/queue                  — request-queue stats (F1306)
 *  POST /ai/resource/evaluate      — resource-guardrail decision (F1307)
 *  GET  /ai/prompt-log             — local prompt/response log (F1316)
 *  DELETE /ai/prompt-log           — clear the log (F1316)
 *  GET  /ai/prompts                — effective prompt templates + overrides (F1317)
 *  PUT  /ai/prompts/:id            — set a prompt override (F1317)
 *  DELETE /ai/prompts/:id          — clear a prompt override (F1317)
 *  POST /ai/prompt-regression      — run golden-output regression cases (F1319)
 */

import { notFound, validation } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { aiRuntimeRepo } from '../db/repos/ai-runtime.js';
import { aiSettingsRepo } from '../ai/settings.js';
import {
  DEFAULT_GUARDRAILS,
  resolveAiAllowed,
  type ResourceGuardrails,
} from '../ai/resource-policy.js';
import {
  isTemplateId,
  listEffectivePrompts,
  resolvePrompt,
  validateOverride,
} from '../ai/prompt-overrides.js';
import { runRegression, type RegressionCase } from '../ai/prompt-regression.js';

const idParam = z.object({ id: z.string().min(1) });

registerRoute({ method: 'POST', path: '/ai/stream', summary: 'Stream a completion (F1305)' });
registerRoute({ method: 'GET', path: '/ai/queue', summary: 'AI request-queue stats (F1306)' });
registerRoute({
  method: 'POST',
  path: '/ai/resource/evaluate',
  summary: 'Resource guardrail (F1307)',
});
registerRoute({ method: 'GET', path: '/ai/prompt-log', summary: 'Local prompt log (F1316)' });
registerRoute({
  method: 'DELETE',
  path: '/ai/prompt-log',
  summary: 'Clear the prompt log (F1316)',
});
registerRoute({ method: 'GET', path: '/ai/prompts', summary: 'Effective prompts (F1317)' });
registerRoute({ method: 'PUT', path: '/ai/prompts/:id', summary: 'Set a prompt override (F1317)' });
registerRoute({
  method: 'DELETE',
  path: '/ai/prompts/:id',
  summary: 'Clear a prompt override (F1317)',
});
registerRoute({
  method: 'POST',
  path: '/ai/prompt-regression',
  summary: 'Prompt regression (F1319)',
});

export const aiRuntimeRoutes: FastifyPluginAsync = async (app) => {
  const repo = aiRuntimeRepo(app.db);
  const settings = aiSettingsRepo(app.db);

  // ── Streaming (F1305) ──
  app.post('/ai/stream', async (request, reply) => {
    const body = parseWith(
      z.object({
        prompt: z.string().min(1).max(20000),
        system: z.string().max(20000).optional(),
        model: z.string().max(200).optional(),
        temperature: z.number().min(0).max(2).optional(),
      }),
      request.body,
      'body',
    );
    if (!(await app.ai.isAvailable())) {
      return reply.status(503).send({ error: { code: 'BAD_REQUEST', message: 'no AI backend' } });
    }
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const controller = new AbortController();
    request.raw.on('close', () => controller.abort());
    try {
      for await (const delta of app.ai.generateStream({
        prompt: body.prompt,
        ...(body.system !== undefined ? { system: body.system } : {}),
        ...(body.model !== undefined ? { model: body.model } : {}),
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        signal: controller.signal,
      })) {
        reply.raw.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
      reply.raw.write('data: [DONE]\n\n');
    } catch (err) {
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ message: (err as Error).message })}\n\n`,
      );
    } finally {
      reply.raw.end();
    }
    return reply;
  });

  // ── Queue stats (F1306) ──
  app.get('/ai/queue', async () => ({ data: app.aiQueue.stats() }));

  // ── Resource guardrails (F1307) ──
  app.post('/ai/resource/evaluate', async (request) => {
    const body = parseWith(
      z.object({
        state: z.object({
          batteryLevel: z.number().min(0).max(1).optional(),
          charging: z.boolean().optional(),
          cpuLoad: z.number().min(0).max(1).optional(),
          memoryPressure: z.number().min(0).max(1).optional(),
        }),
        config: z
          .object({
            minBatteryLevel: z.number().min(0).max(1),
            allowOnCharger: z.boolean(),
            maxCpuLoad: z.number().min(0).max(1),
            maxMemoryPressure: z.number().min(0).max(1),
            enabled: z.boolean(),
          })
          .partial()
          .optional(),
      }),
      request.body,
      'body',
    );
    const overrides = Object.fromEntries(
      Object.entries(body.config ?? {}).filter(([, v]) => v !== undefined),
    );
    const config: ResourceGuardrails = { ...DEFAULT_GUARDRAILS, ...overrides };
    return { data: resolveAiAllowed(body.state, config) };
  });

  // ── Prompt log (F1316) ──
  app.get('/ai/prompt-log', async () => ({
    data: { enabled: settings.get().promptLogging, entries: repo.listLog() },
  }));

  app.delete('/ai/prompt-log', async () => ({ data: { cleared: repo.clearLog() } }));

  // ── Prompt overrides (F1317) ──
  app.get('/ai/prompts', async () => ({
    data: { prompts: listEffectivePrompts(repo.allOverrides()) },
  }));

  app.put('/ai/prompts/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    if (!isTemplateId(id)) throw notFound('prompt template', id);
    const body = parseWith(
      z.object({
        system: z.string().max(20000).optional(),
        template: z.string().max(20000).optional(),
      }),
      request.body,
      'body',
    );
    const check = validateOverride(id, body);
    if (!check.ok) throw validation(check.error);
    repo.setOverride(id, body);
    return { data: resolvePrompt(id, repo.getOverride(id)) };
  });

  app.delete('/ai/prompts/:id', async (request) => {
    const { id } = parseWith(idParam, request.params, 'params');
    repo.clearOverride(id);
    return { data: { cleared: true } };
  });

  // ── Prompt regression (F1319) ──
  app.post('/ai/prompt-regression', async (request, reply) => {
    const body = parseWith(
      z.object({
        cases: z
          .array(
            z.object({
              id: z.string().min(1),
              promptId: z.string().min(1),
              input: z.string(),
              golden: z.string(),
            }),
          )
          .min(1)
          .max(100),
        threshold: z.number().min(0).max(1).optional(),
      }),
      request.body,
      'body',
    );
    if (!(await app.ai.isAvailable())) {
      return reply.status(503).send({ error: { code: 'BAD_REQUEST', message: 'no AI backend' } });
    }
    const cases: RegressionCase[] = body.cases;
    const report = await runRegression(
      cases,
      async ({ input }) => (await app.ai.generate({ prompt: input })).text,
      body.threshold !== undefined ? { threshold: body.threshold } : {},
    );
    return { data: report };
  });
};
