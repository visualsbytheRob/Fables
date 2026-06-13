import { conflict, notFound, validation, type StoryId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { paginated, parsePagination } from '../api/envelope.js';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { withTransaction } from '../db/connection.js';
import {
  mergeSettings,
  storiesRepo,
  type StoryRecord,
  type StoryRelease,
} from '../db/repos/stories.js';
import { storySavesRepo } from '../db/repos/story-saves.js';
import { duplicateStory, recompileStory, starterSource } from '../stories/service.js';

/**
 * Story project routes (F501, F505–F509): CRUD, settings, build status,
 * releases, duplication, and the confirm-gated delete. File-level routes
 * live in story-files.ts, saves in story-saves.ts.
 */

export const fablePathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(
    /^(?:[A-Za-z0-9][\w.-]*\/)*[A-Za-z0-9][\w.-]*\.fable$/,
    'must be a project-relative path ending in .fable (segments start with a letter or digit)',
  );

const settingsSchema = z.object({
  cover: z
    .object({
      color: z.string().max(32).nullable().optional(),
      emoji: z.string().max(16).nullable().optional(),
    })
    .optional(),
  theme: z.string().max(64).nullable().optional(),
  seedMode: z.enum(['fixed', 'random']).optional(),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });
const releaseParamsSchema = z.object({ id: z.string().min(1), releaseId: z.string().min(1) });

const createBodySchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  entryFile: fablePathSchema.optional(),
  settings: settingsSchema.optional(),
  isTemplate: z.boolean().optional(),
});

const patchBodySchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(4000).optional(),
  entryFile: fablePathSchema.optional(),
  settings: settingsSchema.optional(),
  isTemplate: z.boolean().optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
  template: z.enum(['true', 'false']).optional(),
});

const deleteQuerySchema = z.object({ confirm: z.string().optional() });

const duplicateBodySchema = z.object({ title: z.string().min(1).max(300).optional() });

const releaseBodySchema = z.object({ name: z.string().min(1).max(100) });

registerRoute({
  method: 'POST',
  path: '/stories',
  summary: 'Create a story project with its entry file',
  body: createBodySchema,
});
registerRoute({ method: 'GET', path: '/stories', summary: 'List stories', query: listQuerySchema });
registerRoute({
  method: 'GET',
  path: '/stories/:id',
  summary: 'Fetch a story',
  params: idParamsSchema,
});
registerRoute({
  method: 'PATCH',
  path: '/stories/:id',
  summary: 'Update story metadata and settings',
  params: idParamsSchema,
  body: patchBodySchema,
});
registerRoute({
  method: 'DELETE',
  path: '/stories/:id',
  summary: 'Delete a story (requires ?confirm=<exact title>; saves go with it)',
  params: idParamsSchema,
  query: deleteQuerySchema,
});
registerRoute({
  method: 'POST',
  path: '/stories/:id/duplicate',
  summary: 'Duplicate a story (or instantiate a template)',
  params: idParamsSchema,
  body: duplicateBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/build',
  summary: 'Persisted build status + diagnostics',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/stories/:id/build',
  summary: 'Recompile the story now',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/stories/:id/releases',
  summary: 'Compile and snapshot a named release',
  params: idParamsSchema,
  body: releaseBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/releases',
  summary: 'List releases (newest first)',
  params: idParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/releases/:releaseId',
  summary: 'Fetch a release with its source snapshot',
  params: releaseParamsSchema,
});

function releaseMeta(release: StoryRelease): Omit<StoryRelease, 'files'> & { fileCount: number } {
  const { files, ...meta } = release;
  return { ...meta, fileCount: Object.keys(files).length };
}

function buildView(story: StoryRecord, diagnostics: unknown) {
  return {
    storyId: story.id,
    status: story.status,
    errorCount: story.errorCount,
    warningCount: story.warningCount,
    builtAt: story.builtAt,
    entryFile: story.entryFile,
    diagnostics,
  };
}

export const storiesRoutes: FastifyPluginAsync = async (app) => {
  const repo = () => storiesRepo(app.db);

  app.post('/stories', async (request, reply) => {
    const body = parseWith(createBodySchema, request.body, 'body');
    const story = withTransaction(app.db, () => {
      const created = repo().create(body);
      // Every project starts with its entry file; status stays 'draft' until
      // the first compile (save or explicit build).
      repo().createFile(created.id, created.entryFile, starterSource(created.title));
      return created;
    });
    reply.status(201);
    return { data: story };
  });

  app.get('/stories', async (request) => {
    const query = parseWith(listQuerySchema, request.query, 'query');
    const pagination = parsePagination(request.query);
    const rows = repo().list({
      limit: pagination.limit,
      cursor: pagination.cursor,
      ...(query.template !== undefined ? { template: query.template === 'true' } : {}),
    });
    return paginated(rows, pagination);
  });

  app.get('/stories/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    return { data: repo().mustGet(id as StoryId) };
  });

  app.patch('/stories/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(patchBodySchema, request.body, 'body');
    const story = withTransaction(app.db, () => {
      const current = repo().mustGet(id as StoryId);
      if (body.entryFile !== undefined && !repo().getFileByPath(current.id, body.entryFile)) {
        throw validation(`entry file "${body.entryFile}" does not exist in this story`, {
          entryFile: body.entryFile,
        });
      }
      const updated = repo().update(current.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.entryFile !== undefined ? { entryFile: body.entryFile } : {}),
        ...(body.isTemplate !== undefined ? { isTemplate: body.isTemplate } : {}),
        ...(body.settings !== undefined
          ? { settings: mergeSettings(current.settings, body.settings) }
          : {}),
      });
      // A different entry point can change the whole build (F507).
      if (body.entryFile !== undefined && body.entryFile !== current.entryFile) {
        recompileStory(app.db, current.id);
        return repo().mustGet(current.id);
      }
      return updated;
    });
    return { data: story };
  });

  app.delete('/stories/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const query = parseWith(deleteQuerySchema, request.query, 'query');
    const result = withTransaction(app.db, () => {
      const story = repo().mustGet(id as StoryId);
      // Saves hang off stories (F509): deletion must be deliberate.
      if (query.confirm !== story.title) {
        const saveCount = storySavesRepo(app.db).list(story.id).length;
        throw validation('confirm must match the story title exactly', {
          saveCount,
          hint: 'pass ?confirm=<the story title> to delete this story and all of its saves',
        });
      }
      return repo().remove(story.id);
    });
    return { data: { id, deleted: true, ...result } };
  });

  app.post('/stories/:id/duplicate', async (request, reply) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(duplicateBodySchema, request.body, 'body');
    const copy = withTransaction(app.db, () => duplicateStory(app.db, id as StoryId, body.title));
    reply.status(201);
    return { data: copy };
  });

  app.get('/stories/:id/build', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const story = repo().mustGet(id as StoryId);
    return { data: buildView(story, repo().diagnostics(story.id)) };
  });

  app.post('/stories/:id/build', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const outcome = withTransaction(app.db, () => recompileStory(app.db, id as StoryId));
    return { data: buildView(repo().mustGet(id as StoryId), outcome.diagnostics) };
  });

  app.post('/stories/:id/releases', async (request, reply) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(releaseBodySchema, request.body, 'body');
    const release = withTransaction(app.db, () => {
      const story = repo().mustGet(id as StoryId);
      // Releases always compile fresh (F506) — never trust a stale status.
      const outcome = recompileStory(app.db, story.id);
      if (outcome.status === 'broken') {
        throw conflict('cannot release a broken story — fix the errors first', {
          errorCount: outcome.errorCount,
        });
      }
      return repo().createRelease(story.id, {
        name: body.name,
        status: outcome.status,
        entryFile: story.entryFile,
        settings: story.settings,
        files: Object.fromEntries(repo().fileMap(story.id)),
      });
    });
    reply.status(201);
    return { data: releaseMeta(release) };
  });

  app.get('/stories/:id/releases', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const story = repo().mustGet(id as StoryId);
    return { data: repo().listReleases(story.id).map(releaseMeta) };
  });

  app.get('/stories/:id/releases/:releaseId', async (request) => {
    const { id, releaseId } = parseWith(releaseParamsSchema, request.params, 'params');
    const story = repo().mustGet(id as StoryId);
    const release = repo().getRelease(story.id, releaseId);
    if (!release) throw notFound('Release', releaseId);
    return { data: release };
  });
};
