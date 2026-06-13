import type { StoryId } from '@fables/core';
import { createStoryFromSource } from '@fables/forge-vm';
import { describe, expect, it } from 'vitest';
import { buildStory } from '../stories/build.js';
import { openDb } from './connection.js';
import { migrate } from './migrate.js';
import { DEFAULT_SETTINGS, mergeSettings, storiesRepo, type StoriesRepo } from './repos/stories.js';
import { AUTOSAVE_RING_SIZE, storySavesRepo } from './repos/story-saves.js';

/** Repo-level coverage for the story project model (F510). */

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

function project(repo: StoriesRepo) {
  const story = repo.create({ title: 'Repo Tale' });
  repo.createFile(story.id, 'main.fable', 'INCLUDE part.fable\n-> camp\n');
  repo.createFile(story.id, 'part.fable', '=== camp ===\nEmbers glow.\n-> END\n');
  return story;
}

function saveState() {
  const story = createStoryFromSource('Hello there.\n-> END\n', { seed: 1 });
  story.continue();
  return story.saveState();
}

describe('stories repo (F510)', () => {
  it('merges settings without clobbering untouched fields', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { cover: { emoji: '🐍' }, seed: 5 });
    expect(merged).toEqual({
      cover: { color: null, emoji: '🐍' },
      theme: null,
      seedMode: 'random',
      seed: 5,
      journalOptOut: false,
    });
  });

  it('feeds the compiler from fileMap and persists build outcomes', () => {
    const db = freshDb();
    const repo = storiesRepo(db);
    const story = project(repo);

    const outcome = buildStory(story.entryFile, repo.fileMap(story.id));
    expect(outcome.status).toBe('valid');
    repo.setBuild(story.id, outcome);

    const fresh = repo.mustGet(story.id);
    expect(fresh.status).toBe('valid');
    expect(fresh.builtAt).not.toBeNull();
    expect(repo.diagnostics(story.id)).toEqual([]);
  });

  it('cascades files, releases, and saves on story delete', () => {
    const db = freshDb();
    const repo = storiesRepo(db);
    const saves = storySavesRepo(db);
    const story = project(repo);
    repo.createRelease(story.id, {
      name: 'v1',
      status: 'valid',
      entryFile: story.entryFile,
      settings: story.settings,
      files: Object.fromEntries(repo.fileMap(story.id)),
    });
    saves.upsertSlot(story.id, 'slot', saveState());

    const counts = repo.remove(story.id);
    expect(counts).toEqual({ deletedFiles: 2, deletedSaves: 1, deletedReleases: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM scenes').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM story_saves').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM story_releases').get()).toEqual({ n: 0 });
  });

  it('keeps slot names unique per story while autosaves stack', () => {
    const db = freshDb();
    const repo = storiesRepo(db);
    const saves = storySavesRepo(db);
    const a = project(repo);
    const b = repo.create({ title: 'Second' });

    const first = saves.upsertSlot(a.id, 'checkpoint', saveState());
    const again = saves.upsertSlot(a.id, 'checkpoint', saveState());
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.save.id).toBe(first.save.id);
    // Same name on a different story is a different slot.
    expect(saves.upsertSlot(b.id, 'checkpoint', saveState()).created).toBe(true);

    for (let i = 0; i < AUTOSAVE_RING_SIZE + 3; i++) saves.pushAutosave(a.id, saveState());
    expect(saves.list(a.id, 'auto')).toHaveLength(AUTOSAVE_RING_SIZE);
    expect(saves.list(a.id, 'slot')).toHaveLength(1);
  });

  it('404s setBuild and diagnostics for unknown stories', () => {
    const db = freshDb();
    const repo = storiesRepo(db);
    expect(() => repo.diagnostics('story_missing' as StoryId)).toThrowError('Story not found');
    expect(() =>
      repo.setBuild('story_missing' as StoryId, {
        status: 'valid',
        errorCount: 0,
        warningCount: 0,
        diagnostics: [],
      }),
    ).toThrowError('Story not found');
  });
});
