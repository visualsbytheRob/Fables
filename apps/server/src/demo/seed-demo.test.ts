/**
 * Demo world e2e (F699) — seed compiles, plays, queries.
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { seedDemoWorld } from './seed-demo.js';
import { notesRepo } from '../db/repos/notes.js';
import { storiesRepo } from '../db/repos/stories.js';
import { savedQueriesRepo } from '../db/repos/saved-queries.js';
import { runFqlQuery } from '../services/query.js';
import { createStoryFromSource } from '@fables/forge-vm';
import type { StoryId } from '@fables/core';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

describe('demo world (F694/F695/F698/F699)', () => {
  it('seeds notes, a journal, saved queries and a compiled story', () => {
    const db = freshDb();
    const summary = seedDemoWorld(db);
    expect(summary.seeded).toBe(true);
    expect(summary.notes).toBeGreaterThanOrEqual(6);
    expect(summary.savedQueries).toBe(2);
    expect(summary.story).not.toBeNull();
  });

  it('is idempotent — a second seed is a no-op', () => {
    const db = freshDb();
    seedDemoWorld(db);
    expect(seedDemoWorld(db).seeded).toBe(false);
  });

  it('the seeded story compiles cleanly and plays to an ending (F699)', () => {
    const db = freshDb();
    const { story } = seedDemoWorld(db);
    const record = storiesRepo(db).get(story as StoryId)!;
    expect(record.errorCount).toBe(0);
    expect(record.builtAt).not.toBeNull();

    // Play it through a choice to an ending.
    const entry = storiesRepo(db).getFileByPath(record.id, record.entryFile)!;
    const vm = createStoryFromSource(entry.source, { seed: 1 });
    vm.continue();
    vm.choose(0);
    vm.continue();
    expect(vm.saveState().status).toBe('done');
  });

  it('the seeded saved query returns the tagged characters (F695)', () => {
    const db = freshDb();
    seedDemoWorld(db);
    const queries = savedQueriesRepo(db).list();
    const characters = queries.find((q) => q.name === 'Characters')!;
    const { notes } = runFqlQuery(db, characters.fql, { fetch: 50, cursor: null });
    const titles = notes.map((n) => n.title);
    expect(titles).toContain('The Fox');
    expect(titles).toContain('The Crow');
  });

  it('the journal notebook holds the daily entries (F694)', () => {
    const db = freshDb();
    seedDemoWorld(db);
    const { notes } = runFqlQuery(db, 'notebook:Journal', { fetch: 50, cursor: null });
    expect(notes.length).toBeGreaterThanOrEqual(3);
    expect(notesRepo(db).count()).toBeGreaterThanOrEqual(6);
  });
});
