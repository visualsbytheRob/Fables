import type { StoryId } from '@fables/core';
import type { Db } from '../db/connection.js';
import { storiesRepo, type StoryRecord } from '../db/repos/stories.js';
import { knowledgeResolver } from '../services/entities.js';
import { inlineTransclusions } from '../services/transclusion.js';
import { buildStory, type BuildOutcome } from './build.js';

/**
 * Resolve `![[note]]` transclusions in every story source before compilation
 * (F679): each is inlined with provenance comments so referenced note content
 * participates in the build. Returns a new path→source map.
 */
export function resolveTransclusions(
  db: Db,
  files: Map<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, source] of files) {
    out.set(path, source.includes('![[') ? inlineTransclusions(db, source).source : source);
  }
  return out;
}

/**
 * Compile a story from its current files and persist the outcome (F504).
 * Compiles against the live knowledge base, so `@entity` references and
 * `[[note]]` references validate against real entities/notes (F369/F609).
 * `![[note]]` transclusions are inlined before compilation (F679).
 */
export function recompileStory(db: Db, storyId: StoryId): BuildOutcome {
  const repo = storiesRepo(db);
  const story = repo.mustGet(storyId);
  const files = resolveTransclusions(db, repo.fileMap(storyId));
  const outcome = buildStory(story.entryFile, files, knowledgeResolver(db));
  repo.setBuild(storyId, outcome);
  return outcome;
}

/**
 * Duplicate a story project (F508): fresh ids, copied files + settings.
 * Saves and releases stay behind — they belong to the original. Templates
 * duplicate into regular stories.
 */
export function duplicateStory(db: Db, sourceId: StoryId, title?: string): StoryRecord {
  const repo = storiesRepo(db);
  const source = repo.mustGet(sourceId);
  const copy = repo.create({
    title: title ?? `${source.title} (copy)`,
    description: source.description,
    entryFile: source.entryFile,
    settings: source.settings,
    isTemplate: false,
  });
  for (const file of repo.listFiles(sourceId)) {
    repo.createFile(copy.id, file.path, file.source);
  }
  // A built original yields a built copy (same sources ⇒ same outcome).
  if (source.builtAt !== null) recompileStory(db, copy.id);
  return repo.mustGet(copy.id);
}

/** Starter source for a new story's entry file — compiles clean. */
export function starterSource(title: string): string {
  return `# title: ${title}\n\nYour story begins here.\n-> END\n`;
}
