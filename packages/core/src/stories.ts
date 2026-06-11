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
