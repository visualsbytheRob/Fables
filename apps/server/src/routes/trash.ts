import type { FastifyPluginAsync } from 'fastify';
import { paginated, parsePagination } from '../api/envelope.js';
import { registerRoute } from '../api/registry.js';
import { legalHoldRepo } from '../compliance/legal-hold.js';
import { linksRepo } from '../db/repos/links.js';
import { notesRepo } from '../db/repos/notes.js';

registerRoute({ method: 'GET', path: '/trash', summary: 'List trashed notes (paginated)' });
registerRoute({
  method: 'POST',
  path: '/trash/empty',
  summary: 'Hard-delete everything in the trash',
});

export const trashRoutes: FastifyPluginAsync = async (app) => {
  app.get('/trash', async (request) => {
    const pagination = parsePagination(request.query);
    const rows = notesRepo(app.db).listTrashed({
      fetch: pagination.limit + 1,
      cursor: pagination.cursor,
    });
    return paginated(rows, pagination);
  });

  app.post('/trash/empty', async (_request, reply) => {
    // Legal hold guard (F1286): block destructive purge when hold is active.
    const hold = legalHoldRepo(app.db).get();
    if (hold.active) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'legal hold is active — destructive operations are blocked',
          details: { legalHold: true },
        },
      });
    }
    const purged = notesRepo(app.db).purgeTrashed();
    // Link integrity (F219): hard deletes orphan link rows immediately.
    if (purged > 0) linksRepo(app.db).cleanupOrphans();
    return { data: { purged } };
  });
};
