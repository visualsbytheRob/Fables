import type { EntityId, LinkId, NoteId, SceneId, StoryId } from './ids.js';

export type StoryStatus = 'draft' | 'valid' | 'broken';

export interface Story {
  id: StoryId;
  title: string;
  description: string;
  /** Project-relative path of the entry .fable file. */
  entryFile: string;
  status: StoryStatus;
  createdAt: string;
  updatedAt: string;
}

/** One .fable source file inside a story project. */
export interface Scene {
  id: SceneId;
  storyId: StoryId;
  /** Project-relative path, e.g. `chapters/01-forest.fable`. */
  path: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export type EntityType = 'character' | 'place' | 'item' | 'faction' | 'custom';

export interface Entity {
  id: EntityId;
  type: EntityType;
  name: string;
  /** Alternate names used for mention detection and story bindings. */
  aliases: string[];
  /** Schema-validated structured fields (e.g. { health: 100, traits: [...] }). */
  fields: Record<string, unknown>;
  /** Backing note for freeform markdown body, if any. */
  noteId: NoteId | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Entity type schemas (F601/F602) — additive companions to Entity ────── */

export const ENTITY_TYPES = ['character', 'place', 'item', 'faction', 'custom'] as const;

/** Scalar shape of one structured entity field. Mirrors forge-dsl's ForgeType. */
export type EntityFieldType = 'number' | 'string' | 'bool' | 'list';

/** One field definition inside a per-type entity schema (F602/F608). */
export interface EntityFieldDef {
  name: string;
  fieldType: EntityFieldType;
  /** Applied when the field is absent on create. */
  default?: number | string | boolean | unknown[] | undefined;
  required?: boolean | undefined;
}

/** A typed relationship slot (ally-of, located-in, …) creating relation links (F606). */
export interface EntityRelationDef {
  name: string;
  /** Restricts targets to one entity type; null allows any. */
  targetType: EntityType | null;
}

/** The user-editable schema for one entity type (F602/F609). */
export interface EntityTypeSchema {
  type: EntityType;
  fields: EntityFieldDef[];
  relations: EntityRelationDef[];
  updatedAt: string;
}

export type LinkKind = 'wikilink' | 'mention' | 'binding' | 'relation';
export type LinkableType = 'note' | 'entity' | 'story' | 'scene';

export interface Link {
  id: LinkId;
  kind: LinkKind;
  sourceType: LinkableType;
  sourceId: string;
  targetType: LinkableType;
  targetId: string;
  /** Character offset of the reference in the source body, when applicable. */
  position: number | null;
  createdAt: string;
}
