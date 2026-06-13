import type { Entity, StoryId } from '@fables/core';
import { parse } from '@fables/forge-dsl';
import type { Db } from '../db/connection.js';
import { storiesRepo } from '../db/repos/stories.js';

/**
 * Story knowledge permissions (F648). Stories declare the entities they may
 * touch in entry-file header tags:
 *
 *   # entities: hero, fox     → readable + writable
 *   # reads: ledger           → readable only
 *   # writes: hero            → writable (and implicitly readable)
 *   # tags: quest, dragon     → tag-presence checks the knowledge feed reports
 *
 * A story that declares none of entities/reads/writes is unrestricted — the
 * pre-F648 behaviour. Once any declaration exists, ENTITY_SET effects against
 * undeclared entities are FORBIDDEN and the knowledge-state feed only serves
 * declared-readable entities.
 */

export interface StoryDeclarations {
  /** True once any of entities/reads/writes is declared. */
  declared: boolean;
  /** Lowercased names readable by the story; null = unrestricted. */
  readable: Set<string> | null;
  /** Lowercased names writable by the story; null = unrestricted. */
  writable: Set<string> | null;
  /** Raw declared lists, original casing, for reporting. */
  entities: string[];
  reads: string[];
  writes: string[];
  /** `# tags:` names whose presence the knowledge feed reports (F643). */
  tags: string[];
}

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

/** Parses `# key: a, b` declarations from a story entry-file source. */
export function parseDeclarations(entrySource: string): StoryDeclarations {
  const lists: Record<'entities' | 'reads' | 'writes' | 'tags', string[]> = {
    entities: [],
    reads: [],
    writes: [],
    tags: [],
  };
  const { story } = parse(entrySource);
  for (const tag of story.headerTags) {
    const colon = tag.text.indexOf(':');
    if (colon === -1) continue;
    const key = tag.text.slice(0, colon).trim().toLowerCase();
    if (key === 'entities' || key === 'reads' || key === 'writes' || key === 'tags') {
      lists[key].push(...splitList(tag.text.slice(colon + 1)));
    }
  }

  const declared = lists.entities.length + lists.reads.length + lists.writes.length > 0;
  const lc = (names: string[]): string[] => names.map((n) => n.toLowerCase());
  return {
    declared,
    readable: declared ? new Set([...lc(lists.entities), ...lc(lists.reads), ...lc(lists.writes)]) : null,
    writable: declared ? new Set([...lc(lists.entities), ...lc(lists.writes)]) : null,
    entities: lists.entities,
    reads: lists.reads,
    writes: lists.writes,
    tags: lists.tags,
  };
}

/** Declarations for a stored story, parsed from its current entry file. */
export function storyDeclarations(db: Db, storyId: StoryId): StoryDeclarations {
  const repo = storiesRepo(db);
  const story = repo.mustGet(storyId);
  const entry = repo.getFileByPath(storyId, story.entryFile);
  return parseDeclarations(entry?.source ?? '');
}

/** True when any of the entity's names is in the (lowercased) declared set. */
export function entityMatches(declared: Set<string>, entity: Entity): boolean {
  return [entity.name, ...entity.aliases].some((n) => declared.has(n.toLowerCase()));
}

export function canRead(decl: StoryDeclarations, entity: Entity): boolean {
  return decl.readable === null || entityMatches(decl.readable, entity);
}

export function canWrite(decl: StoryDeclarations, entity: Entity): boolean {
  return decl.writable === null || entityMatches(decl.writable, entity);
}
