/**
 * Playback repo tests (F1673/F1674/F1675/F1678).
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../connection.js';
import { migrate } from '../migrate.js';
import { playbackRepo } from './playback.js';

function freshRepo() {
  const db = openDb(':memory:');
  migrate(db);
  return playbackRepo(db);
}

describe('position (F1673/F1678)', () => {
  it('saves, accumulates listened time, and marks completion', () => {
    const repo = freshRepo();
    repo.position.save('story', 's1', 1000, 10_000, 1000);
    let pos = repo.position.get('story', 's1')!;
    expect(pos.positionMs).toBe(1000);
    expect(pos.listenedMs).toBe(1000);
    expect(pos.completed).toBe(false);

    // Advance to the end → completed; listened accumulates.
    pos = repo.position.save('story', 's1', 10_000, 10_000, 9000);
    expect(pos.completed).toBe(true);
    expect(pos.listenedMs).toBe(10_000);
  });

  it('aggregates listening stats across items', () => {
    const repo = freshRepo();
    repo.position.save('story', 's1', 10_000, 10_000, 10_000); // completed
    repo.position.save('note', 'n1', 500, 5000, 500); // in progress
    const stats = repo.position.stats();
    expect(stats.totalListenedMs).toBe(10_500);
    expect(stats.completed).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.items).toBe(2);
  });

  it('clears a position', () => {
    const repo = freshRepo();
    repo.position.save('note', 'n1', 100, 1000);
    expect(repo.position.clear('note', 'n1')).toBe(true);
    expect(repo.position.get('note', 'n1')).toBeNull();
  });
});

describe('queue (F1674)', () => {
  it('appends, reorders, and removes entries', () => {
    const repo = freshRepo();
    const a = repo.queue.add('story', 's1', 'One');
    const b = repo.queue.add('note', 'n1', 'Two');
    expect(repo.queue.list().map((e) => e.id)).toEqual([a.id, b.id]);

    repo.queue.reorder([b.id, a.id]);
    expect(repo.queue.list().map((e) => e.id)).toEqual([b.id, a.id]);

    expect(repo.queue.remove(a.id)).toBe(true);
    expect(repo.queue.list()).toHaveLength(1);
  });
});

describe('pins (F1675)', () => {
  it('pins and unpins items', () => {
    const repo = freshRepo();
    expect(repo.pins.isPinned('story', 's1')).toBe(false);
    repo.pins.set('story', 's1', true, 'Pinned Tale');
    expect(repo.pins.isPinned('story', 's1')).toBe(true);
    expect(repo.pins.list()).toHaveLength(1);
    repo.pins.set('story', 's1', false);
    expect(repo.pins.isPinned('story', 's1')).toBe(false);
  });
});
