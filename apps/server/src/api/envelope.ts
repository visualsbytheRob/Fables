import { validation } from '@fables/core';
import { z } from 'zod';

/**
 * Response envelope conventions (F081):
 *   success: { data }                with optional { page } for lists
 *   failure: { error: { code, message, details } }   (set by the global error handler)
 */

export interface Page {
  /** Opaque cursor for the next page; null when exhausted. */
  nextCursor: string | null;
  limit: number;
}

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export interface Pagination {
  limit: number;
  cursor: string | null;
}

export function parsePagination(query: unknown): Pagination {
  const parsed = paginationQuerySchema.safeParse(query ?? {});
  if (!parsed.success) {
    throw validation('invalid pagination parameters', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  return { limit: parsed.data.limit, cursor: parsed.data.cursor ?? null };
}

/**
 * Standard list response: fetch `limit + 1` rows, pass them here, and the
 * extra row (if present) becomes proof of a next page.
 */
export function paginated<T extends { id: string }>(
  rows: T[],
  pagination: Pagination,
): { data: T[]; page: Page } {
  const hasMore = rows.length > pagination.limit;
  const data = hasMore ? rows.slice(0, pagination.limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    page: {
      nextCursor: hasMore && last ? last.id : null,
      limit: pagination.limit,
    },
  };
}
