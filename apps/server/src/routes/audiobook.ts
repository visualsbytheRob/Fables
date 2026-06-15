/**
 * Audiobook export routes (Epic 17, F1661–F1670).
 *
 *  POST /stories/:id/audiobook      — chapters + metadata + size estimate + cue
 *                                     sheet for a chosen story path (F1661–F1668)
 *  POST /notebooks/:id/audiobook    — listen to a whole notebook: one chapter
 *                                     per note (F1666)
 *
 * Container muxing (m4b/mp3/opus encode) is a codec concern for the export/web
 * layer; this produces the chapter plan, metadata, and upfront size estimate it
 * bakes, plus a `.cue` sheet for chapter-aware players.
 */

import { notFound } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { NotebookId, StoryId } from '@fables/core';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { storiesRepo } from '../db/repos/stories.js';
import { castingRepo } from '../db/repos/casting.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import {
  buildScene,
  estimateDurationMs,
  type AudioScene,
  type SceneItem,
} from '../audio/narration/scene.js';
import {
  buildAudiobookManifest,
  toCueSheet,
  type AudioExportFormat,
} from '../audio/export/audiobook.js';

registerRoute({
  method: 'POST',
  path: '/stories/:id/audiobook',
  summary: 'Audiobook chapters + manifest for a path (F1661/F1662)',
});
registerRoute({
  method: 'POST',
  path: '/notebooks/:id/audiobook',
  summary: 'Listen to a notebook: one chapter per note (F1666)',
});

const FORMATS = ['wav', 'mp3', 'opus', 'm4b'] as const;

const metadataSchema = z.object({
  title: z.string().min(1).max(500),
  author: z.string().max(500).optional(),
  narrator: z.string().max(500).optional(),
  cover: z.string().max(2_000_000).optional(),
});

const storyBody = z.object({
  path: z.array(z.string().min(1)).min(1).max(2000),
  format: z.enum(FORMATS).optional(),
  wpm: z.number().int().min(60).max(400).optional(),
  metadata: metadataSchema.optional(),
});

const notebookBody = z.object({
  format: z.enum(FORMATS).optional(),
  wpm: z.number().int().min(60).max(400).optional(),
  metadata: metadataSchema.partial({ title: true }).optional(),
});

/** Build metadata, defaulting the title from a fallback when not provided. */
function metadata(
  input:
    | {
        title?: string | undefined;
        author?: string | undefined;
        narrator?: string | undefined;
        cover?: string | undefined;
      }
    | undefined,
  fallbackTitle: string,
): { title: string; author?: string; narrator?: string; cover?: string } {
  return {
    title: input?.title ?? fallbackTitle,
    ...(input?.author !== undefined ? { author: input.author } : {}),
    ...(input?.narrator !== undefined ? { narrator: input.narrator } : {}),
    ...(input?.cover !== undefined ? { cover: input.cover } : {}),
  };
}

export const audiobookRoutes: FastifyPluginAsync = async (app) => {
  const stories = storiesRepo(app.db);
  const casting = castingRepo(app.db);
  const notebooks = notebooksRepo(app.db);
  const notes = notesRepo(app.db);

  app.post('/stories/:id/audiobook', async (request) => {
    const { id } = parseWith(z.object({ id: z.string().min(1) }), request.params, 'params');
    const body = parseWith(storyBody, request.body, 'body');
    const story = stories.mustGet(id as StoryId);
    const source = stories
      .listFiles(id as StoryId)
      .map((f) => f.source)
      .join('\n\n');
    const cast = casting.castSheets.manifest(id).sheet;
    const scene = buildScene(source, body.path, cast, {
      ...(body.wpm !== undefined ? { wpm: body.wpm } : {}),
    });
    const format: AudioExportFormat = body.format ?? 'm4b';
    const manifest = buildAudiobookManifest(scene, metadata(body.metadata, story.title), format);
    return { data: { manifest, cue: toCueSheet(manifest) } };
  });

  app.post('/notebooks/:id/audiobook', async (request) => {
    const { id } = parseWith(z.object({ id: z.string().min(1) }), request.params, 'params');
    const body = parseWith(notebookBody, request.body, 'body');
    const notebook = notebooks.get(id as NotebookId);
    if (!notebook) throw notFound('notebook', id);
    const wpm = body.wpm ?? 155;
    const items: SceneItem[] = notes.listByNotebook(id as NotebookId).map((note) => {
      const text = note.body.trim().length > 0 ? note.body : note.title;
      return {
        kind: 'line',
        knot: note.title || 'Untitled',
        text,
        speaker: null,
        voice: null,
        estDurationMs: estimateDurationMs(text, wpm),
      };
    });
    const scene: AudioScene = {
      items,
      totalEstMs: items.reduce((n, i) => n + i.estDurationMs, 0),
    };
    const format: AudioExportFormat = body.format ?? 'm4b';
    const manifest = buildAudiobookManifest(scene, metadata(body.metadata, notebook.name), format);
    return { data: { manifest, cue: toCueSheet(manifest) } };
  });
};
