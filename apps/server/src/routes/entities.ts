import { ENTITY_TYPES, type EntityId, type LinkId } from '@fables/core';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { paginated, parsePagination } from '../api/envelope.js';
import { registerRoute } from '../api/registry.js';
import { parseWith } from '../api/validate.js';
import { withTransaction } from '../db/connection.js';
import { entitiesRepo } from '../db/repos/entities.js';
import { entitySchemasRepo } from '../db/repos/entity-schemas.js';
import { codexRepo } from '../db/repos/codex.js';
import { linksRepo } from '../db/repos/links.js';
import {
  convertEntityMentions,
  createEntity,
  deleteEntity,
  ensureBackingNote,
  entityView,
  updateEntity,
  validateSchemaDefinition,
} from '../services/entities.js';

/**
 * Entity routes (F601–F610): typed CRUD with schema validation, per-type
 * schema introspection/editing, backing-note creation, search, and unlinked
 * mention listing/conversion.
 */

const entityTypeSchema = z.enum(ENTITY_TYPES);

const nameSchema = z.string().min(2).max(200);

const fieldDefSchema = z.object({
  name: z.string().min(1).max(100),
  fieldType: z.enum(['number', 'string', 'bool', 'list']),
  default: z.union([z.number(), z.string(), z.boolean(), z.array(z.unknown())]).optional(),
  required: z.boolean().optional(),
});

const relationDefSchema = z.object({
  name: z.string().min(1).max(100),
  targetType: entityTypeSchema.nullable(),
});

const relationsSchema = z.record(z.string().min(1), z.array(z.string().min(1)));

const createBodySchema = z.object({
  type: entityTypeSchema,
  name: nameSchema,
  aliases: z.array(nameSchema).max(20).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  relations: relationsSchema.optional(),
});

const patchBodySchema = z.object({
  name: nameSchema.optional(),
  aliases: z.array(nameSchema).max(20).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  relations: relationsSchema.optional(),
});

const schemaPutBodySchema = z.object({
  fields: z.array(fieldDefSchema).max(50).optional(),
  relations: z.array(relationDefSchema).max(50).optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });
const typeParamsSchema = z.object({ type: entityTypeSchema });

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
  type: entityTypeSchema.optional(),
  q: z.string().max(200).optional(),
});

const convertBodySchema = z.object({
  mentionId: z.string().min(1).optional(),
  all: z.boolean().optional(),
});

registerRoute({
  method: 'GET',
  path: '/entities/schemas',
  summary: 'Every entity type schema (compiler introspection, F369)',
});
registerRoute({
  method: 'GET',
  path: '/entities/schemas/:type',
  summary: 'One entity type schema',
  params: typeParamsSchema,
});
registerRoute({
  method: 'PUT',
  path: '/entities/schemas/:type',
  summary: 'Replace the field/relation definitions of an entity type',
  params: typeParamsSchema,
  body: schemaPutBodySchema,
});
registerRoute({
  method: 'POST',
  path: '/entities',
  summary: 'Create a typed entity (fields validated against the type schema)',
  body: createBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/entities',
  summary: 'List/search entities by type, name, or alias',
  query: listQuerySchema,
});
registerRoute({
  method: 'GET',
  path: '/entities/:id',
  summary: 'Fetch an entity with its relations',
  params: idParamsSchema,
});
registerRoute({
  method: 'PATCH',
  path: '/entities/:id',
  summary: 'Update an entity (field patches merge, then re-validate)',
  params: idParamsSchema,
  body: patchBodySchema,
});
registerRoute({
  method: 'DELETE',
  path: '/entities/:id',
  summary: 'Delete an entity and its relation/mention links',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/entities/:id/note',
  summary: 'Create (or fetch) the backing note on demand',
  params: idParamsSchema,
});
registerRoute({
  method: 'GET',
  path: '/entities/:id/mentions',
  summary: 'Unlinked mentions of the entity across notes',
  params: idParamsSchema,
});
registerRoute({
  method: 'POST',
  path: '/entities/:id/mentions/convert',
  summary: 'Convert unlinked mentions into wikilinks to the backing note',
  params: idParamsSchema,
  body: convertBodySchema,
});
registerRoute({
  method: 'GET',
  path: '/entities/:id/mutations',
  summary: 'ENTITY_SET audit trail for one entity (world inspector)',
  params: idParamsSchema,
});

export const entitiesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/entities/schemas', async () => {
    return { data: entitySchemasRepo(app.db).list() };
  });

  app.get('/entities/schemas/:type', async (request) => {
    const { type } = parseWith(typeParamsSchema, request.params, 'params');
    return { data: entitySchemasRepo(app.db).mustGet(type) };
  });

  app.put('/entities/schemas/:type', async (request) => {
    const { type } = parseWith(typeParamsSchema, request.params, 'params');
    const body = parseWith(schemaPutBodySchema, request.body, 'body');
    const schema = withTransaction(app.db, () => {
      const repo = entitySchemasRepo(app.db);
      const current = repo.mustGet(type);
      const fields = body.fields ?? current.fields;
      const relations = body.relations ?? current.relations;
      validateSchemaDefinition(fields, relations);
      return repo.update(type, { fields, relations });
    });
    return { data: schema };
  });

  app.post('/entities', async (request, reply) => {
    const body = parseWith(createBodySchema, request.body, 'body');
    const entity = createEntity(app.db, {
      type: body.type,
      name: body.name,
      ...(body.aliases !== undefined ? { aliases: body.aliases } : {}),
      ...(body.fields !== undefined ? { fields: body.fields } : {}),
      ...(body.relations !== undefined
        ? { relations: body.relations as Record<string, EntityId[]> }
        : {}),
    });
    reply.status(201);
    return { data: entity };
  });

  app.get('/entities', async (request) => {
    const query = parseWith(listQuerySchema, request.query, 'query');
    const pagination = parsePagination(request.query);
    const rows = entitiesRepo(app.db).list({
      fetch: pagination.limit + 1,
      cursor: pagination.cursor,
      ...(query.type !== undefined ? { type: query.type } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
    });
    return paginated(
      rows.map((e) => entityView(app.db, e)),
      pagination,
    );
  });

  app.get('/entities/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const entity = entitiesRepo(app.db).mustGet(id as EntityId);
    return {
      data: {
        ...entityView(app.db, entity),
        incomingRelations: entitiesRepo(app.db).incomingRelations(entity.id),
      },
    };
  });

  app.patch('/entities/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(patchBodySchema, request.body, 'body');
    const entity = updateEntity(app.db, id as EntityId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.aliases !== undefined ? { aliases: body.aliases } : {}),
      ...(body.fields !== undefined ? { fields: body.fields } : {}),
      ...(body.relations !== undefined
        ? { relations: body.relations as Record<string, EntityId[]> }
        : {}),
    });
    return { data: entity };
  });

  app.delete('/entities/:id', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    deleteEntity(app.db, id as EntityId);
    return { data: { id, deleted: true } };
  });

  app.post('/entities/:id/note', async (request, reply) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const result = ensureBackingNote(app.db, id as EntityId);
    reply.status(result.created ? 201 : 200);
    return { data: result };
  });

  app.get('/entities/:id/mentions', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const entity = entitiesRepo(app.db).mustGet(id as EntityId);
    const mentions = linksRepo(app.db)
      .incoming(entity.id, 'mention')
      .map((m) => ({
        id: m.id,
        sourceId: m.sourceId,
        sourceTitle: m.sourceTitle,
        position: m.position,
        length: m.length,
        text: m.sourceBody.slice(m.position, m.position + m.length),
      }));
    return { data: mentions };
  });

  app.post('/entities/:id/mentions/convert', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const body = parseWith(convertBodySchema, request.body, 'body');
    const result = convertEntityMentions(app.db, id as EntityId, {
      ...(body.mentionId !== undefined ? { mentionId: body.mentionId as LinkId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    return { data: result };
  });

  app.get('/entities/:id/mutations', async (request) => {
    const { id } = parseWith(idParamsSchema, request.params, 'params');
    const entity = entitiesRepo(app.db).mustGet(id as EntityId);
    return { data: codexRepo(app.db).listMutationsForEntity(entity.id) };
  });
};
