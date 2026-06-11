import { monotonicFactory } from 'ulid';

/* Monotonic: ids generated in the same millisecond still sort by creation order. */
const ulid = monotonicFactory();

declare const brand: unique symbol;
/** Nominal typing: a string that can't be confused with another ID kind. */
export type Branded<T, B extends string> = T & { readonly [brand]: B };

export type NoteId = Branded<string, 'NoteId'>;
export type NotebookId = Branded<string, 'NotebookId'>;
export type TagId = Branded<string, 'TagId'>;
export type AttachmentId = Branded<string, 'AttachmentId'>;
export type StoryId = Branded<string, 'StoryId'>;
export type SceneId = Branded<string, 'SceneId'>;
export type EntityId = Branded<string, 'EntityId'>;
export type LinkId = Branded<string, 'LinkId'>;

function makeIdFactory<T extends string>(prefix: string) {
  return (): T => `${prefix}_${ulid()}` as T;
}

export const newNoteId = makeIdFactory<NoteId>('note');
export const newNotebookId = makeIdFactory<NotebookId>('nb');
export const newTagId = makeIdFactory<TagId>('tag');
export const newAttachmentId = makeIdFactory<AttachmentId>('att');
export const newStoryId = makeIdFactory<StoryId>('story');
export const newSceneId = makeIdFactory<SceneId>('scene');
export const newEntityId = makeIdFactory<EntityId>('ent');
export const newLinkId = makeIdFactory<LinkId>('link');

const ID_PATTERN = /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/;

/** True if the string has the shape `prefix_<ULID>`. */
export function isId(value: string, prefix?: string): boolean {
  if (!ID_PATTERN.test(value)) return false;
  return prefix === undefined || value.startsWith(`${prefix}_`);
}
