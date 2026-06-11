import { validation } from '@fables/core';
import type { z } from 'zod';

/** Parses request parts with zod; throws a VALIDATION AppError naming every issue. */
export function parseWith<T extends z.ZodType>(schema: T, value: unknown, part: string): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw validation(`invalid ${part}`, {
      part,
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    });
  }
  return parsed.data;
}
