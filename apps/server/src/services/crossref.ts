import { notFound, type EntityId, type NoteId, type StoryId } from '@fables/core';
import { findAllBindings, parse } from '@fables/forge-dsl';
import type { Db } from '../db/connection.js';
import { entitiesRepo } from '../db/repos/entities.js';
import { linksRepo } from '../db/repos/links.js';
import { notesRepo } from '../db/repos/notes.js';
import { storiesRepo } from '../db/repos/stories.js';
import { storyDeclarations } from './permissions.js';

/**
 * Cross-reference + dependency/impact analysis (F661–F670). Story → knowledge
 * bindings are not persisted as link rows; they live in `.fable` sources, so we
 * scan those sources for `@entity` / `[[note]]` references on demand.
 */

export interface StoryRef {
  storyId: StoryId;
  title: string;
  /** Files within the story that reference the target. */
  files: string[];
}

interface ScannedStoryRefs {
  entityNames: Set<string>;
  noteTitles: Set<string>;
}

/** All `@entity` / `[[note]]` references in a story's sources, by file. */
function scanStory(db: Db, storyId: StoryId): Map<string, ScannedStoryRefs> {
  const byFile = new Map<string, ScannedStoryRefs>();
  for (const file of storiesRepo(db).listFiles(storyId)) {
    let parsed;
    try {
      parsed = parse(file.source, { fileName: file.path });
    } catch {
      continue;
    }
    const refs: ScannedStoryRefs = { entityNames: new Set(), noteTitles: new Set() };
    for (const ref of findAllBindings(parsed.story)) {
      if (ref.kind === 'EntityRef') refs.entityNames.add((ref.displayName ?? ref.name).toLowerCase());
      else refs.noteTitles.add(ref.title.toLowerCase());
    }
    byFile.set(file.path, refs);
  }
  return byFile;
}

/** Stories whose sources reference the given note title (case-insensitive). */
export function storiesReferencingNote(db: Db, titleLc: string): StoryRef[] {
  const out: StoryRef[] = [];
  for (const story of allStories(db)) {
    const files: string[] = [];
    for (const [path, refs] of scanStory(db, story.id)) {
      if (refs.noteTitles.has(titleLc)) files.push(path);
    }
    if (files.length > 0) out.push({ storyId: story.id, title: story.title, files: files.sort() });
  }
  return out;
}

/** Stories whose sources reference the given entity (by any of its names). */
export function storiesReferencingEntity(db: Db, names: string[]): StoryRef[] {
  const nameSet = new Set(names.map((n) => n.toLowerCase()));
  const out: StoryRef[] = [];
  for (const story of allStories(db)) {
    const files: string[] = [];
    for (const [path, refs] of scanStory(db, story.id)) {
      if ([...refs.entityNames].some((n) => nameSet.has(n))) files.push(path);
    }
    // Declared (read/write) entities count as a dependency even without a textual ref.
    const decl = storyDeclarations(db, story.id);
    const declaredMatch =
      decl.readable !== null &&
      [...nameSet].some((n) => decl.readable!.has(n));
    if (files.length > 0 || declaredMatch) {
      out.push({ storyId: story.id, title: story.title, files: files.sort() });
    }
  }
  return out;
}

function allStories(db: Db): { id: StoryId; title: string }[] {
  const repo = storiesRepo(db);
  const out: { id: StoryId; title: string }[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = repo.list({ limit: 200, cursor });
    out.push(...page.slice(0, 200).map((s) => ({ id: s.id, title: s.title })));
    if (page.length <= 200) break;
    cursor = page[199]!.id;
  }
  return out;
}

// ── incoming references (F661/F662) ─────────────────────────────────────────

export interface RefGroup {
  kind: string;
  count: number;
  refs: { sourceId: string; sourceTitle: string; meta?: Record<string, unknown> }[];
}

export interface IncomingRefs {
  type: 'note' | 'entity' | 'story';
  id: string;
  groups: RefGroup[];
  total: number;
}

/** Everything pointing at a note/entity/story, grouped by reference kind (F661/F662). */
export function incomingRefs(db: Db, type: 'note' | 'entity' | 'story', id: string): IncomingRefs {
  const groups: RefGroup[] = [];

  if (type === 'note') {
    const note = notesRepo(db).get(id as NoteId);
    if (!note) throw notFound('Note', id);
    for (const kind of ['wikilink', 'mention'] as const) {
      const rows = linksRepo(db).incoming(id, kind);
      if (rows.length > 0) {
        groups.push({
          kind,
          count: rows.length,
          refs: rows.map((r) => ({ sourceId: r.sourceId, sourceTitle: r.sourceTitle })),
        });
      }
    }
    const stories = storiesReferencingNote(db, note.title.toLowerCase());
    if (stories.length > 0) {
      groups.push({
        kind: 'binding',
        count: stories.length,
        refs: stories.map((s) => ({ sourceId: s.storyId, sourceTitle: s.title, meta: { files: s.files } })),
      });
    }
  } else if (type === 'entity') {
    const entity = entitiesRepo(db).mustGet(id as EntityId);
    const mentions = linksRepo(db).incoming(entity.id, 'mention');
    if (mentions.length > 0) {
      groups.push({
        kind: 'mention',
        count: mentions.length,
        refs: mentions.map((r) => ({ sourceId: r.sourceId, sourceTitle: r.sourceTitle })),
      });
    }
    const relations = entitiesRepo(db).incomingRelations(entity.id);
    if (relations.length > 0) {
      groups.push({
        kind: 'relation',
        count: relations.length,
        refs: relations.map((r) => ({ sourceId: r.sourceId, sourceTitle: r.name })),
      });
    }
    const stories = storiesReferencingEntity(db, [entity.name, ...entity.aliases]);
    if (stories.length > 0) {
      groups.push({
        kind: 'binding',
        count: stories.length,
        refs: stories.map((s) => ({ sourceId: s.storyId, sourceTitle: s.title, meta: { files: s.files } })),
      });
    }
  } else {
    storiesRepo(db).mustGet(id as StoryId);
    // What points at a story: playthroughs and releases.
    const releases = storiesRepo(db).listReleases(id as StoryId);
    if (releases.length > 0) {
      groups.push({
        kind: 'release',
        count: releases.length,
        refs: releases.map((r) => ({ sourceId: r.id, sourceTitle: r.name })),
      });
    }
  }

  return { type, id, groups, total: groups.reduce((n, g) => n + g.count, 0) };
}

// ── dependencies (F663) ─────────────────────────────────────────────────────

export interface StoryDependencies {
  storyId: StoryId;
  /** Entities the story reads (referenced fields or declared readable). */
  reads: { entities: string[]; notes: string[] };
  /** Entities the story writes (declared writable). */
  writes: { entities: string[] };
}

/** Everything a story reads/writes — from bindings + declared entities (F663). */
export function storyDependencies(db: Db, storyId: StoryId): StoryDependencies {
  storiesRepo(db).mustGet(storyId);
  const decl = storyDeclarations(db, storyId);
  const entityReads = new Set<string>();
  const noteReads = new Set<string>();
  for (const refs of scanStory(db, storyId).values()) {
    for (const n of refs.entityNames) entityReads.add(n);
    for (const t of refs.noteTitles) noteReads.add(t);
  }
  for (const name of decl.reads) entityReads.add(name.toLowerCase());
  for (const name of decl.entities) entityReads.add(name.toLowerCase());

  const writes = new Set<string>();
  for (const name of decl.writes) writes.add(name.toLowerCase());
  for (const name of decl.entities) writes.add(name.toLowerCase());

  return {
    storyId,
    reads: { entities: [...entityReads].sort(), notes: [...noteReads].sort() },
    writes: { entities: [...writes].sort() },
  };
}

// ── impact (F664/F665) ──────────────────────────────────────────────────────

export interface Impact {
  type: 'note' | 'entity';
  id: string;
  /** Stories that reference this object. */
  stories: StoryRef[];
  /** True when at least one built story would lose a binding if it changed. */
  wouldBreakBuilds: boolean;
}

/** Which stories reference a note and which valid builds would break (F664). */
export function noteImpact(db: Db, noteId: NoteId): Impact {
  const note = notesRepo(db).get(noteId);
  if (!note) throw notFound('Note', noteId);
  const stories = storiesReferencingNote(db, note.title.toLowerCase());
  return { type: 'note', id: noteId, stories, wouldBreakBuilds: hasValidBuild(db, stories) };
}

/** Which stories reference an entity and which valid builds would break (F664). */
export function entityImpact(db: Db, entityId: EntityId): Impact {
  const entity = entitiesRepo(db).mustGet(entityId);
  const stories = storiesReferencingEntity(db, [entity.name, ...entity.aliases]);
  return { type: 'entity', id: entityId, stories, wouldBreakBuilds: hasValidBuild(db, stories) };
}

function hasValidBuild(db: Db, stories: StoryRef[]): boolean {
  const repo = storiesRepo(db);
  return stories.some((s) => {
    const story = repo.get(s.storyId);
    return story?.status === 'valid' && story.builtAt !== null;
  });
}

// ── rebind (F669) ───────────────────────────────────────────────────────────

export interface RebindResult {
  from: string;
  to: string;
  toEntityId: EntityId;
  /** Story id → files rewritten. */
  stories: { storyId: StoryId; files: string[]; recompiled: boolean }[];
  references: number;
}

/**
 * Batch re-bind every `@oldName` reference across all stories to `@newName`,
 * rewriting the `.fable` sources span-precisely and recompiling each affected
 * story (F669). `toName` must resolve to an existing entity so bindings stay
 * valid.
 */
export function rebindEntity(
  db: Db,
  fromEntityId: EntityId,
  toName: string,
  recompile: (storyId: StoryId) => void,
): RebindResult {
  const entities = entitiesRepo(db);
  const from = entities.mustGet(fromEntityId);
  const target = entities.getByName(toName);
  if (!target) throw notFound('Entity', toName);

  const oldNames = new Set([from.name.toLowerCase(), ...from.aliases.map((a) => a.toLowerCase())]);
  const stories = storiesRepo(db);
  const touched: RebindResult['stories'] = [];
  let references = 0;

  for (const story of allStories(db)) {
    const rewrites = new Map<string, string>();
    for (const file of stories.listFiles(story.id)) {
      let parsed;
      try {
        parsed = parse(file.source, { fileName: file.path });
      } catch {
        continue;
      }
      // Collect entity-ref spans whose name matches, then splice back-to-front.
      const hits = findAllBindings(parsed.story)
        .filter(
          (ref): ref is Extract<typeof ref, { kind: 'EntityRef' }> =>
            ref.kind === 'EntityRef' &&
            oldNames.has((ref.displayName ?? ref.name).toLowerCase()),
        )
        .sort((a, b) => b.span.start.offset - a.span.start.offset);
      if (hits.length === 0) continue;

      let next = file.source;
      for (const hit of hits) {
        // Replace only the binding identifier; keep an existing `.field` suffix.
        const fieldSuffix = hit.field !== undefined ? `.${hit.field}` : '';
        const replacement =
          hit.displayName !== undefined ? `@entity(${target.name})${fieldSuffix}` : `@${target.name}${fieldSuffix}`;
        next = next.slice(0, hit.span.start.offset) + replacement + next.slice(hit.span.end.offset);
        references += 1;
      }
      if (next !== file.source) rewrites.set(file.path, next);
    }

    if (rewrites.size > 0) {
      stories.setFileSources(story.id, rewrites);
      const wasBuilt = stories.get(story.id)?.builtAt !== null;
      if (wasBuilt) recompile(story.id);
      touched.push({ storyId: story.id, files: [...rewrites.keys()].sort(), recompiled: wasBuilt });
    }
  }

  return { from: from.name, to: target.name, toEntityId: target.id, stories: touched, references };
}
