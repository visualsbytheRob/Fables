import {
  notFound,
  nowIso,
  type EntityFieldDef,
  type EntityRelationDef,
  type EntityType,
  type EntityTypeSchema,
} from '@fables/core';
import type { Db } from '../connection.js';

/**
 * Per-type entity field/relation schemas (F602/F608/F609). One row per entity
 * type, seeded by migration 009 and user-editable via PUT /entities/schemas/:type.
 */

interface Row {
  type: string;
  fields: string;
  relations: string;
  updated_at: string;
}

function toSchema(row: Row): EntityTypeSchema {
  return {
    type: row.type as EntityType,
    fields: JSON.parse(row.fields) as EntityFieldDef[],
    relations: JSON.parse(row.relations) as EntityRelationDef[],
    updatedAt: row.updated_at,
  };
}

export function entitySchemasRepo(db: Db) {
  return {
    list(): EntityTypeSchema[] {
      const rows = db.prepare('SELECT * FROM entity_schemas ORDER BY type').all() as Row[];
      return rows.map(toSchema);
    },

    get(type: EntityType): EntityTypeSchema | null {
      const row = db.prepare('SELECT * FROM entity_schemas WHERE type = ?').get(type) as
        | Row
        | undefined;
      return row ? toSchema(row) : null;
    },

    mustGet(type: EntityType): EntityTypeSchema {
      const schema = this.get(type);
      if (!schema) throw notFound('Entity schema', type);
      return schema;
    },

    update(
      type: EntityType,
      patch: { fields?: EntityFieldDef[]; relations?: EntityRelationDef[] },
    ): EntityTypeSchema {
      const current = this.mustGet(type);
      const next: EntityTypeSchema = {
        ...current,
        fields: patch.fields ?? current.fields,
        relations: patch.relations ?? current.relations,
        updatedAt: nowIso(),
      };
      db.prepare(
        'UPDATE entity_schemas SET fields = ?, relations = ?, updated_at = ? WHERE type = ?',
      ).run(JSON.stringify(next.fields), JSON.stringify(next.relations), next.updatedAt, type);
      return next;
    },
  };
}

export type EntitySchemasRepo = ReturnType<typeof entitySchemasRepo>;
