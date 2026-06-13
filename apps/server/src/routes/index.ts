import type { FastifyPluginAsync } from 'fastify';
import { attachmentsRoutes } from './attachments.js';
import { codexRoutes } from './codex.js';
import { debugRoutes } from './debug.js';
import { effectsRoutes } from './effects.js';
import { entitiesRoutes } from './entities.js';
import { graphRoutes } from './graph.js';
import { healthRoutes } from './health.js';
import { importExportRoutes } from './import-export.js';
import { linksRoutes } from './links.js';
import { notebooksRoutes } from './notebooks.js';
import { notesRoutes } from './notes.js';
import { queryRoutes } from './query.js';
import { revisionsRoutes } from './revisions.js';
import { savedQueriesRoutes } from './saved-queries.js';
import { storiesRoutes } from './stories.js';
import { storyFilesRoutes } from './story-files.js';
import { storySavesRoutes } from './story-saves.js';
import { tagsRoutes } from './tags.js';
import { trashRoutes } from './trash.js';

/** Every resource module exports a plugin and registers here — one line per resource. */
export const routes: FastifyPluginAsync[] = [
  healthRoutes,
  debugRoutes,
  notesRoutes,
  linksRoutes,
  graphRoutes,
  revisionsRoutes,
  trashRoutes,
  notebooksRoutes,
  tagsRoutes,
  attachmentsRoutes,
  queryRoutes,
  savedQueriesRoutes,
  importExportRoutes,
  storiesRoutes,
  storyFilesRoutes,
  storySavesRoutes,
  entitiesRoutes,
  codexRoutes,
  effectsRoutes,
];
