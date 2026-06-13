import { conflict, notFound, type SceneId, type StoryId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { withTransaction } from '../db/connection.js';
import { storiesRepo, type StoryFile } from '../db/repos/stories.js';
import {
  findIncluders,
  normalizeProjectPath,
  rewriteIncludesForRename,
  type BuildOutcome,
} from '../stories/build.js';
import { recompileStory } from '../stories/service.js';
import { fablePathSchema } from './stories.js';

/**
 * Story file (.fable scene) routes (F502–F504): CRUD with rename
 * include-integrity and compile-on-save. Every mutation recompiles the story
 * and returns the fresh build outcome so editors get diagnostics in one trip.
 */

const storyParamsSchema = z.object({ id: z.string().min(1) });
const fileParamsSchema = z.object({ id: z.string().min(1), fileId: z.string().min(1) });

const createBodySchema = z.object({
  path: fablePathSchema,
  source: z
    .string()
    .max(1024 * 1024)
    .optional(),
});

const patchBodySchema = z
  .object({
    path: fablePathSchema.optional(),
    source: z
      .string()
      .max(1024 * 1024)
      .optional(),
  })
  .refine((b) => b.path !== undefined || b.source !== undefined, {
    message: 'provide path and/or source',
  });

const deleteQuerySchema = z.object({ force: z.enum(['true', 'false']).optional() });

registerRoute({
  method: 'POST',
  path: '/stories/:id/files',
  summary: 'Create a .fable file (compiles the story)',
  params: storyParamsSchema,
  body: createBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/files',
  summary: 'List story files (metadata only)',
  params: storyParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/stories/:id/files/:fileId',
  summary: 'Fetch a file with its source',
  params: fileParamsSchema,
});
registerRoute({
  method: 'PATCH',
  path: '/stories/:id/files/:fileId',
  summary: 'Update source and/or rename (rewrites INCLUDE references, compiles)',
  params: fileParamsSchema,
  body: patchBodySchema,
});
registerRoute({
  method: 'DELETE',
  path: '/stories/:id/files/:fileId',
  summary: 'Delete a file (409 when INCLUDEd elsewhere unless ?force=true)',
  params: fileParamsSchema,
  query: deleteQuerySchema,
});

function fileMeta(file: StoryFile): Omit<StoryFile, 'source'> & { bytes: number } {
  const { source, ...meta } = file;
  return { ...meta, bytes: Buffer.byteLength(source, 'utf8') };
}

export const storyFilesRoutes: FastifyPluginAsync = async (app) => {
  const repo = () => storiesRepo(app.db);

  app.post('/stories/:id/files', async (request, reply) => {
    const { id } = parseWith(storyParamsSchema, request.params, 'params');
    const body = parseWith(createBodySchema, request.body, 'body');
    const result = withTransaction(app.db, () => {
      const story = repo().mustGet(id as StoryId);
      const file = repo().createFile(story.id, normalizeProjectPath(body.path), body.source ?? '');
      return { file, build: recompileStory(app.db, story.id) };
    });
    reply.status(201);
    return { data: result };
  });

  app.get('/stories/:id/files', async (request) => {
    const { id } = parseWith(storyParamsSchema, request.params, 'params');
    const story = repo().mustGet(id as StoryId);
    return { data: repo().listFiles(story.id).map(fileMeta) };
  });

  app.get('/stories/:id/files/:fileId', async (request) => {
    const { id, fileId } = parseWith(fileParamsSchema, request.params, 'params');
    const story = repo().mustGet(id as StoryId);
    const file = repo().getFile(story.id, fileId as SceneId);
    if (!file) throw notFound('Story file', fileId);
    return { data: file };
  });

  app.patch('/stories/:id/files/:fileId', async (request) => {
    const { id, fileId } = parseWith(fileParamsSchema, request.params, 'params');
    const body = parseWith(patchBodySchema, request.body, 'body');
    const result = withTransaction(
      app.db,
      (): {
        file: StoryFile;
        build: BuildOutcome;
        rewrittenFiles: string[];
      } => {
        const story = repo().mustGet(id as StoryId);
        const current = repo().getFile(story.id, fileId as SceneId);
        if (!current) throw notFound('Story file', fileId);

        const newPath = body.path !== undefined ? normalizeProjectPath(body.path) : current.path;
        const renaming = newPath !== current.path;

        // Project view with the incoming source applied — rename rewrites must
        // run against what is about to be saved, not what was saved before.
        const files = repo().fileMap(story.id);
        if (body.source !== undefined) files.set(current.path, body.source);

        let rewrittenFiles: string[] = [];
        let ownSource = files.get(current.path) as string;
        if (renaming) {
          const rewritten = rewriteIncludesForRename(files, current.path, newPath);
          const own = rewritten.get(current.path);
          if (own !== undefined) {
            ownSource = own;
            rewritten.delete(current.path);
          }
          rewrittenFiles = [...rewritten.keys()].sort();
          repo().setFileSources(story.id, rewritten);
        }

        const file = repo().updateFile(story.id, current.id, {
          path: newPath,
          source: ownSource,
        });
        // Renaming the entry file follows it (F503/F507).
        if (renaming && story.entryFile === current.path) {
          repo().update(story.id, { entryFile: newPath });
        }
        return { file, build: recompileStory(app.db, story.id), rewrittenFiles };
      },
    );
    return { data: result };
  });

  app.delete('/stories/:id/files/:fileId', async (request) => {
    const { id, fileId } = parseWith(fileParamsSchema, request.params, 'params');
    const query = parseWith(deleteQuerySchema, request.query, 'query');
    const force = query.force === 'true';
    const result = withTransaction(app.db, () => {
      const story = repo().mustGet(id as StoryId);
      const file = repo().getFile(story.id, fileId as SceneId);
      if (!file) throw notFound('Story file', fileId);
      if (!force) {
        const includedBy = findIncluders(repo().fileMap(story.id), file.path);
        if (includedBy.length > 0) {
          throw conflict(
            `"${file.path}" is INCLUDEd by other files — pass ?force=true to delete anyway`,
            { includedBy },
          );
        }
        if (file.path === story.entryFile) {
          throw conflict(
            `"${file.path}" is the story entry file — pass ?force=true to delete anyway`,
            { entryFile: story.entryFile },
          );
        }
      }
      repo().deleteFile(story.id, file.id);
      return {
        id: file.id,
        path: file.path,
        deleted: true,
        build: recompileStory(app.db, story.id),
      };
    });
    return { data: result };
  });
};
