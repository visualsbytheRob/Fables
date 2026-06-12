import type { FastifyPluginAsync } from 'fastify';
import { attachmentsRoutes } from './attachments.js';
import { debugRoutes } from './debug.js';
import { graphRoutes } from './graph.js';
import { healthRoutes } from './health.js';
import { linksRoutes } from './links.js';
import { notebooksRoutes } from './notebooks.js';
import { notesRoutes } from './notes.js';
import { revisionsRoutes } from './revisions.js';
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
];
