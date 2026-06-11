import { z } from 'zod';
import { ERROR_CODES } from './errors.js';

const isoDate = z.iso.datetime();
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`));

export const noteSchema = z.object({
  id: id('note'),
  notebookId: id('nb'),
  title: z.string().max(500),
  body: z.string(),
  pinned: z.boolean(),
  trashedAt: isoDate.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  rev: z.number().int().nonnegative(),
});

export const notebookSchema = z.object({
  id: id('nb'),
  parentId: id('nb').nullable(),
  name: z.string().min(1).max(200),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  archived: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const tagSchema = z.object({
  id: id('tag'),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[^\s#]+$/, 'tag names cannot contain spaces or #'),
  color: z.string().nullable(),
  createdAt: isoDate,
});

export const attachmentSchema = z.object({
  id: id('att'),
  noteId: id('note').nullable(),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: isoDate,
});

export const storySchema = z.object({
  id: id('story'),
  title: z.string().min(1).max(300),
  description: z.string(),
  entryFile: z.string().min(1),
  status: z.enum(['draft', 'valid', 'broken']),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const sceneSchema = z.object({
  id: id('scene'),
  storyId: id('story'),
  path: z.string().min(1).max(500),
  source: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const entitySchema = z.object({
  id: id('ent'),
  type: z.enum(['character', 'place', 'item', 'faction', 'custom']),
  name: z.string().min(1).max(300),
  aliases: z.array(z.string().min(1)),
  fields: z.record(z.string(), z.unknown()),
  noteId: id('note').nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const linkSchema = z.object({
  id: id('link'),
  kind: z.enum(['wikilink', 'mention', 'binding', 'relation']),
  sourceType: z.enum(['note', 'entity', 'story', 'scene']),
  sourceId: z.string().min(1),
  targetType: z.enum(['note', 'entity', 'story', 'scene']),
  targetId: z.string().min(1),
  position: z.number().int().nonnegative().nullable(),
  createdAt: isoDate,
});

export const errorCodeSchema = z.enum(ERROR_CODES);
