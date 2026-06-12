import type { Note } from '@fables/core';
import { describe, expect, it } from 'vitest';
import { openDb } from './connection.js';
import { migrate } from './migrate.js';
import { notebooksRepo } from './repos/notebooks.js';
import { notesRepo } from './repos/notes.js';
import { revisionsRepo } from './repos/revisions.js';

function setup() {
  const db = openDb(':memory:');
  migrate(db);
  const nb = notebooksRepo(db).create({ name: 'Test' });
  const note = notesRepo(db).create({ notebookId: nb.id, title: 'v0', body: 'body v0' });
  return { db, note, revisions: revisionsRepo(db) };
}

describe('revision snapshots', () => {
  it('appends snapshots with word/char counts and a content hash', () => {
    const { note, revisions } = setup();
    expect(revisions.snapshot(note)).toBe(true);
    const head = revisions.latest(note.id)!;
    expect(head.rev).toBe(0);
    expect(head.wordCount).toBe(2);
    expect(head.charCount).toBe('body v0'.length);
    expect(head.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('skips no-op snapshots via content hash (F116)', () => {
    const { note, revisions } = setup();
    expect(revisions.snapshot(note)).toBe(true);
    // Same content, bumped rev (e.g. a pinned-only update) — no new snapshot.
    expect(revisions.snapshot({ ...note, rev: 1 })).toBe(false);
    expect(revisions.list(note.id)).toHaveLength(1);
    // Changed content snapshots again.
    expect(revisions.snapshot({ ...note, rev: 2, body: 'body v2' })).toBe(true);
    expect(revisions.list(note.id)).toHaveLength(2);
  });

  it('lists newest-first without bodies; get returns the body', () => {
    const { note, revisions } = setup();
    revisions.snapshot(note);
    revisions.snapshot({ ...note, rev: 1, body: 'body v1' });
    const list = revisions.list(note.id);
    expect(list.map((r) => r.rev)).toEqual([1, 0]);
    expect('body' in list[0]!).toBe(false);
    expect(revisions.get(note.id, 1)?.body).toBe('body v1');
    expect(revisions.get(note.id, 99)).toBeNull();
  });
});

describe('revision pruning (F112)', () => {
  const NOW = '2026-06-12T12:00:00.000Z';

  function snapAt(
    revisions: ReturnType<typeof revisionsRepo>,
    note: Note,
    rev: number,
    now: string,
  ) {
    expect(revisions.snapshot({ ...note, rev, body: `body v${rev}` }, { now })).toBe(true);
  }

  it('keeps everything <24h, then one snapshot per day', () => {
    const { note, revisions } = setup();
    snapAt(revisions, note, 1, '2026-06-09T10:00:00.000Z'); // 3 days ago, superseded same day
    snapAt(revisions, note, 2, '2026-06-09T11:00:00.000Z'); // 3 days ago, day survivor
    snapAt(revisions, note, 3, '2026-06-10T09:00:00.000Z'); // 2 days ago, day survivor
    snapAt(revisions, note, 4, '2026-06-11T06:00:00.000Z'); // 30h ago, day survivor
    snapAt(revisions, note, 5, '2026-06-12T10:00:00.000Z'); // 2h ago — inside the 24h window
    snapAt(revisions, note, 6, '2026-06-12T11:59:00.000Z'); // 1min ago — inside the 24h window

    expect(revisions.prune(note.id, { now: NOW })).toBe(1);
    expect(revisions.list(note.id).map((r) => r.rev)).toEqual([6, 5, 4, 3, 2]);
  });

  it('is a no-op when every snapshot is fresh', () => {
    const { note, revisions } = setup();
    snapAt(revisions, note, 1, '2026-06-12T11:00:00.000Z');
    snapAt(revisions, note, 2, '2026-06-12T11:30:00.000Z');
    expect(revisions.prune(note.id, { now: NOW })).toBe(0);
  });

  it('never deletes the sole survivor of an old day, even across many prunes', () => {
    const { note, revisions } = setup();
    snapAt(revisions, note, 1, '2026-06-01T08:00:00.000Z');
    expect(revisions.prune(note.id, { now: NOW })).toBe(0);
    expect(revisions.prune(note.id, { now: NOW })).toBe(0);
    expect(revisions.list(note.id)).toHaveLength(1);
  });

  it('only prunes the targeted note', () => {
    const { db, note, revisions } = setup();
    const other = notesRepo(db).create({ notebookId: note.notebookId, title: 'other' });
    snapAt(revisions, note, 1, '2026-06-09T10:00:00.000Z');
    snapAt(revisions, note, 2, '2026-06-09T11:00:00.000Z');
    revisions.snapshot({ ...other, body: 'kept' }, { now: '2026-06-09T10:30:00.000Z' });
    expect(revisions.prune(note.id, { now: NOW })).toBe(1);
    expect(revisions.list(other.id)).toHaveLength(1);
  });
});
