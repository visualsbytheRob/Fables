import type { z } from 'zod';

/**
 * Route schema registry (F085): every route registers its shape here.
 * The typed web client (and later generated docs) consume this single
 * source of truth instead of duplicating types by hand.
 */
export interface RouteSchema {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
}

const registry: RouteSchema[] = [];

export function registerRoute(schema: RouteSchema): RouteSchema {
  registry.push(schema);
  return schema;
}

export function listRoutes(): readonly RouteSchema[] {
  return registry;
}
