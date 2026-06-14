/**
 * Character & dialogue routes (F1351–F1358). Author-supplied character sheets,
 * facts, and world descriptions go in; grounded suggestions come out. Nothing is
 * written back — the author applies suggestions as normal edits. Graceful to
 * `{ available: false }` when no backend is present.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import {
  buildVoiceCard,
  extractFacts,
  generateDialogue,
  generateNames,
  interviewCharacter,
  polishDialogue,
  suggestRelationshipDynamics,
  trackArc,
} from '../ai/character-ai.js';

registerRoute({
  method: 'POST',
  path: '/ai/character/dialogue',
  summary: 'Entity-grounded dialogue (F1351)',
});
registerRoute({
  method: 'POST',
  path: '/ai/character/voice',
  summary: 'Build a voice card (F1352)',
});
registerRoute({ method: 'POST', path: '/ai/character/polish', summary: 'Polish dialogue (F1353)' });
registerRoute({
  method: 'POST',
  path: '/ai/character/interview',
  summary: 'Interview a character in-voice (F1354)',
});
registerRoute({
  method: 'POST',
  path: '/ai/character/facts',
  summary: 'Extract facts from a transcript (F1355)',
});
registerRoute({
  method: 'POST',
  path: '/ai/character/relationships',
  summary: 'Suggest relationship dynamics (F1356)',
});
registerRoute({ method: 'POST', path: '/ai/character/names', summary: 'Generate names (F1357)' });
registerRoute({
  method: 'POST',
  path: '/ai/character/arc',
  summary: 'Track a character arc (F1358)',
});

const TEXT = z.string().min(1).max(20_000);

const dialogueInput = z.object({ sheet: TEXT, situation: TEXT });
const voiceInput = z.object({ name: z.string().min(1).max(200), lines: TEXT });
const polishInput = z.object({ dialogue: TEXT });
const interviewInput = z.object({
  sheet: TEXT,
  question: z.string().min(1).max(2000),
  history: z
    .array(z.object({ question: z.string().min(1), answer: z.string().min(1) }))
    .max(40)
    .optional(),
});
const factsInput = z.object({ transcript: TEXT });
const relationshipsInput = z.object({ graph: TEXT });
const namesInput = z.object({ world: TEXT, kind: z.string().min(1).max(200) });
const arcInput = z.object({ name: z.string().min(1).max(200), scenes: TEXT });

export const aiCharacterRoutes: FastifyPluginAsync = async (app) => {
  app.post('/ai/character/dialogue', async (request) => {
    const { sheet, situation } = parseWith(dialogueInput, request.body, 'body');
    return { data: await generateDialogue(app.ai, sheet, situation) };
  });

  app.post('/ai/character/voice', async (request) => {
    const { name, lines } = parseWith(voiceInput, request.body, 'body');
    return { data: await buildVoiceCard(app.ai, name, lines) };
  });

  app.post('/ai/character/polish', async (request) => {
    const { dialogue } = parseWith(polishInput, request.body, 'body');
    return { data: await polishDialogue(app.ai, dialogue) };
  });

  app.post('/ai/character/interview', async (request) => {
    const { sheet, question, history } = parseWith(interviewInput, request.body, 'body');
    return { data: await interviewCharacter(app.ai, sheet, question, history ?? []) };
  });

  app.post('/ai/character/facts', async (request) => {
    const { transcript } = parseWith(factsInput, request.body, 'body');
    return { data: await extractFacts(app.ai, transcript) };
  });

  app.post('/ai/character/relationships', async (request) => {
    const { graph } = parseWith(relationshipsInput, request.body, 'body');
    return { data: await suggestRelationshipDynamics(app.ai, graph) };
  });

  app.post('/ai/character/names', async (request) => {
    const { world, kind } = parseWith(namesInput, request.body, 'body');
    return { data: await generateNames(app.ai, world, kind) };
  });

  app.post('/ai/character/arc', async (request) => {
    const { name, scenes } = parseWith(arcInput, request.body, 'body');
    return { data: await trackArc(app.ai, name, scenes) };
  });
};
