import fs from 'node:fs';
import multipart, { type MultipartFile } from '@fastify/multipart';
import { AppError, notFound, validation, type AttachmentId, type NoteId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { paginated, parsePagination } from '../api/envelope.js';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import {
  attachmentPath,
  gcAttachments,
  removeAttachmentFile,
  saveAttachmentFile,
} from '../attachments/store.js';
import { withTransaction } from '../db/connection.js';
import { attachmentsRepo } from '../db/repos/attachments.js';
import { notesRepo } from '../db/repos/notes.js';
import { sha256Hex } from '../lib/hash.js';

/** Upload limit (F165). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Allowlist (F165): images, PDF, audio, and plain-text formats. */
export function isAllowedMime(mime: string): boolean {
  return (
    mime.startsWith('image/') ||
    mime.startsWith('audio/') ||
    mime.startsWith('text/') ||
    mime === 'application/pdf'
  );
}

const idParamsSchema = z.object({ id: z.string().min(1) });

registerRoute({
  method: 'POST',
  path: '/attachments',
  summary: 'Upload an attachment (multipart, content-addressed)',
});
registerRoute({ method: 'GET', path: '/attachments', summary: 'List attachments (paginated)' });
registerRoute({
  method: 'GET',
  path: '/attachments/:id',
  summary: 'Stream an attachment with its mime type',
  params: idParamsSchema,
});
registerRoute({
  method: 'DELETE',
  path: '/attachments/:id',
  summary: 'Delete an attachment (file removed when unshared)',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/attachments/gc',
  summary: 'Garbage-collect unreferenced attachments',
});

/** Reads a string field that arrived alongside the file part (must precede it in the form). */
function fieldValue(part: MultipartFile, name: string): string | null {
  const field = part.fields[name];
  const first = Array.isArray(field) ? field[0] : field;
  if (!first || first.type !== 'field' || typeof first.value !== 'string') return null;
  return first.value;
}

export const attachmentsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } });

  app.post('/attachments', async (request, reply) => {
    if (!request.isMultipart()) throw validation('expected a multipart/form-data request');
    const part = await request.file();
    if (!part) throw validation('missing "file" field in the multipart form');
    if (!isAllowedMime(part.mimetype)) {
      throw validation(
        `file type "${part.mimetype}" is not allowed — images, audio, text, and PDF only`,
        { mime: part.mimetype },
      );
    }

    let content: Buffer;
    try {
      content = await part.toBuffer();
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError('PAYLOAD_TOO_LARGE', 'attachment exceeds the 25 MB limit', {
          details: { limitBytes: MAX_ATTACHMENT_BYTES },
        });
      }
      throw error;
    }

    const noteIdField = fieldValue(part, 'noteId');
    if (noteIdField !== null && !notesRepo(app.db).get(noteIdField as NoteId)) {
      throw notFound('Note', noteIdField);
    }

    const hash = sha256Hex(content);
    saveAttachmentFile(app.dataDir, hash, content);
    const attachment = attachmentsRepo(app.db).create({
      noteId: noteIdField as NoteId | null,
      filename: part.filename || 'untitled',
      mime: part.mimetype,
      size: content.byteLength,
      hash,
    });
    reply.status(201);
    return { data: attachment };
  });

  app.get('/attachments', async (request) => {
    const pagination = parsePagination(request.query);
    const rows = attachmentsRepo(app.db).list({
      fetch: pagination.limit + 1,
      cursor: pagination.cursor,
    });
    return paginated(rows, pagination);
  });

  app.get('/attachments/:id', async (request, reply) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const attachment = attachmentsRepo(app.db).get(id as AttachmentId);
    if (!attachment) throw notFound('Attachment', id);
    const file = attachmentPath(app.dataDir, attachment.hash);
    if (!fs.existsSync(file)) throw notFound('Attachment file', id);
    const safeName = attachment.filename.replace(/["\\\r\n]/g, '_');
    return reply
      .header('content-type', attachment.mime)
      .header('content-length', attachment.size)
      .header('content-disposition', `inline; filename="${safeName}"`)
      .send(fs.createReadStream(file));
  });

  app.delete('/attachments/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const repo = attachmentsRepo(app.db);
    const attachment = repo.get(id as AttachmentId);
    if (!attachment) throw notFound('Attachment', id);
    withTransaction(app.db, () => repo.remove(attachment.id));
    // Content-addressed: only unlink the blob when no other row shares the hash.
    const fileDeleted =
      repo.countByHash(attachment.hash) === 0 && removeAttachmentFile(app.dataDir, attachment.hash);
    return { data: { id, deleted: true, fileDeleted } };
  });

  /** Manual GC (F164) — also runs automatically as a boot-time sweep. */
  app.post('/attachments/gc', async () => ({
    data: gcAttachments(app.db, app.dataDir),
  }));
};
