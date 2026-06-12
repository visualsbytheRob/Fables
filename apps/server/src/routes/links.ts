import { notFound, validation, type LinkId, type NoteId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { linksRepo, type IncomingLink } from '../db/repos/links.js';
import { notesRepo } from '../db/repos/notes.js';
import { contextSnippet, type Snippet } from '../lib/snippets.js';
import { convertMentions } from '../services/mentions.js';
import { mintBlockId } from '../services/notes.js';

const idParamsSchema = z.object({ id: z.string().min(1) });

const blockIdBodySchema = z.object({
  /** 0-based line index in the note body. */
  line: z.number().int().nonnegative(),
});

const convertBodySchema = z.object({
  mentionId: z.string().min(1).optional(),
  all: z.boolean().optional(),
});

registerRoute({
  method: 'GET',
  path: '/notes/:id/backlinks',
  summary: 'Incoming wikilinks grouped by source note, with context snippets',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/notes/:id/block-id',
  summary: 'Mint (or return) a stable ^block-id for one line of a note',
  params: idParamsSchema,
  body: blockIdBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/notes/:id/mentions',
  summary: 'Unlinked mentions of this note grouped by source note',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/notes/:id/mentions/link',
  summary: 'Convert one (mentionId) or all mentions into wikilinks',
  params: idParamsSchema,
  body: convertBodySchema,
});

interface IncomingItem {
  id: string;
  position: number;
  length: number;
  text: string;
  heading: string | null;
  blockId: string | null;
  snippet: Snippet;
}

interface IncomingGroup {
  note: { id: string; title: string; notebookId: string; updatedAt: string };
  count: number;
  links: IncomingItem[];
}

/** Groups incoming rows by source note, preserving recency order (F211, F217). */
function groupBySource(rows: IncomingLink[]): IncomingGroup[] {
  const groups = new Map<string, IncomingGroup>();
  for (const row of rows) {
    let group = groups.get(row.sourceId);
    if (!group) {
      group = {
        note: {
          id: row.sourceId,
          title: row.sourceTitle,
          notebookId: row.sourceNotebookId,
          updatedAt: row.sourceUpdatedAt,
        },
        count: 0,
        links: [],
      };
      groups.set(row.sourceId, group);
    }
    group.count += 1;
    group.links.push({
      id: row.id,
      position: row.position,
      length: row.length,
      text: row.sourceBody.slice(row.position, row.position + row.length),
      heading: row.targetHeading,
      blockId: row.targetBlock,
      snippet: contextSnippet(row.sourceBody, row.position, row.length),
    });
  }
  return [...groups.values()];
}

export const linksRoutes: FastifyPluginAsync = async (app) => {
  app.get('/notes/:id/backlinks', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    if (!notesRepo(app.db).get(id as NoteId)) throw notFound('Note', id);
    const rows = linksRepo(app.db).incoming(id as NoteId, 'wikilink');
    return { data: { noteId: id, total: rows.length, sources: groupBySource(rows) } };
  });

  app.post('/notes/:id/block-id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const { line } = parseWith(blockIdBodySchema, request.body, 'body');
    const result = mintBlockId(app.db, id as NoteId, line);
    return { data: result };
  });

  app.get('/notes/:id/mentions', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    if (!notesRepo(app.db).get(id as NoteId)) throw notFound('Note', id);
    const rows = linksRepo(app.db).incoming(id as NoteId, 'mention');
    return { data: { noteId: id, total: rows.length, sources: groupBySource(rows) } };
  });

  app.post('/notes/:id/mentions/link', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(convertBodySchema, request.body, 'body');
    if ((body.mentionId === undefined) === (body.all !== true)) {
      throw validation('pass exactly one of mentionId or all: true');
    }
    const result = convertMentions(app.db, id as NoteId, {
      ...(body.mentionId !== undefined ? { mentionId: body.mentionId as LinkId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    return { data: result };
  });
};
