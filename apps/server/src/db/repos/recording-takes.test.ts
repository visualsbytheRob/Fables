/**
 * Recording takes repo tests (F1651/F1653/F1659).
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../connection.js';
import { migrate } from '../migrate.js';
import { recordingTakesRepo } from './recording-takes.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe('recordingTakesRepo (F1651/F1659)', () => {
  it('first take for a line becomes active; content-addressed dedup', () => {
    const repo = recordingTakesRepo(freshDb());
    const a = repo.add({ storyId: 's', lineKey: 'k:0', audio: bytes('take-one'), format: 'opus' });
    expect(a.active).toBe(true);
    expect(a.contentHash).toHaveLength(64);

    // Re-adding identical bytes dedupes to the same take.
    const dup = repo.add({
      storyId: 's',
      lineKey: 'k:0',
      audio: bytes('take-one'),
      format: 'opus',
    });
    expect(dup.id).toBe(a.id);
    expect(repo.list('s', 'k:0')).toHaveLength(1);
  });

  it('picks the best take and promotes on delete (F1653)', () => {
    const repo = recordingTakesRepo(freshDb());
    const t1 = repo.add({ storyId: 's', lineKey: 'k:0', audio: bytes('one'), format: 'opus' });
    const t2 = repo.add({ storyId: 's', lineKey: 'k:0', audio: bytes('two'), format: 'opus' });
    expect(repo.active('s', 'k:0')?.id).toBe(t1.id); // first stays active

    expect(repo.setActive(t2.id)).toBe(true);
    expect(repo.active('s', 'k:0')?.id).toBe(t2.id);

    // Deleting the active take promotes the remaining one.
    expect(repo.remove(t2.id)).toBe(true);
    expect(repo.active('s', 'k:0')?.id).toBe(t1.id);
  });

  it('round-trips audio bytes', () => {
    const repo = recordingTakesRepo(freshDb());
    const t = repo.add({ storyId: 's', lineKey: 'k:1', audio: bytes('hello'), format: 'wav' });
    expect(new TextDecoder().decode(repo.audio(t.id)!)).toBe('hello');
    expect(repo.audio('nope')).toBeNull();
  });

  it('reports active recorded line keys (F1656)', () => {
    const repo = recordingTakesRepo(freshDb());
    repo.add({ storyId: 's', lineKey: 'k:0', audio: bytes('a'), format: 'opus' });
    repo.add({ storyId: 's', lineKey: 'k:2', audio: bytes('b'), format: 'opus' });
    const keys = repo.recordedLineKeys('s');
    expect(keys.has('k:0')).toBe(true);
    expect(keys.has('k:2')).toBe(true);
    expect(keys.has('k:1')).toBe(false);
  });
});
