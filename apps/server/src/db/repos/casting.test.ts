/**
 * Casting repo tests (F1611/F1616/F1617/F1619).
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../connection.js';
import { migrate } from '../migrate.js';
import { castingRepo } from './casting.js';
import { entitiesRepo } from './entities.js';
import type { CastSheet } from '../../audio/casting/resolve.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

const SHEET: CastSheet = {
  narrator: { voiceId: 'mock-narrator' },
  bySpeaker: { alice: { voiceId: 'mock-amy', rate: 1.1 } },
  defaultCharacter: { voiceId: 'mock-ben' },
};

describe('entityVoices (F1611/F1615)', () => {
  it('assigns, reads, and clears an entity voice', () => {
    const db = freshDb();
    const ent = entitiesRepo(db).create({
      type: 'character',
      name: 'Alice',
      aliases: [],
      fields: {},
    });
    const repo = castingRepo(db);

    expect(repo.entityVoices.get(ent.id)).toBeNull();
    repo.entityVoices.set(ent.id, { voiceId: 'mock-amy', rate: 1.2 });
    const got = repo.entityVoices.get(ent.id);
    expect(got?.voiceId).toBe('mock-amy');
    expect(got?.rate).toBe(1.2);
    expect(got?.pitch).toBeUndefined();

    // Upsert replaces.
    repo.entityVoices.set(ent.id, { voiceId: 'mock-ben' });
    expect(repo.entityVoices.get(ent.id)?.voiceId).toBe('mock-ben');
    expect(repo.entityVoices.list()).toHaveLength(1);

    expect(repo.entityVoices.remove(ent.id)).toBe(true);
    expect(repo.entityVoices.get(ent.id)).toBeNull();
  });

  it('cascades when the entity is deleted', () => {
    const db = freshDb();
    const ent = entitiesRepo(db).create({
      type: 'character',
      name: 'Bob',
      aliases: [],
      fields: {},
    });
    const repo = castingRepo(db);
    repo.entityVoices.set(ent.id, { voiceId: 'v' });
    entitiesRepo(db).remove(ent.id);
    expect(repo.entityVoices.get(ent.id)).toBeNull();
  });
});

describe('castSheets (F1616/F1617/F1619)', () => {
  it('saves and reads a story cast sheet', () => {
    const repo = castingRepo(freshDb());
    const rec = repo.castSheets.create({ storyId: 'story1', name: 'Main', sheet: SHEET });
    expect(rec.storyId).toBe('story1');
    expect(repo.castSheets.forStory('story1')?.id).toBe(rec.id);
    expect(repo.castSheets.get(rec.id)?.sheet.bySpeaker['alice']?.voiceId).toBe('mock-amy');
  });

  it('updates an existing sheet', () => {
    const repo = castingRepo(freshDb());
    const rec = repo.castSheets.create({ storyId: 's', sheet: SHEET });
    const next = repo.castSheets.update(rec.id, { name: 'Renamed' });
    expect(next?.name).toBe('Renamed');
    expect(repo.castSheets.update('nope', { name: 'x' })).toBeNull();
  });

  it('templates are story-less sheets (F1617)', () => {
    const repo = castingRepo(freshDb());
    repo.castSheets.create({ storyId: null, name: 'Fantasy', sheet: SHEET });
    repo.castSheets.create({ storyId: 'attached', sheet: SHEET });
    const templates = repo.castSheets.templates();
    expect(templates).toHaveLength(1);
    expect(templates[0]!.name).toBe('Fantasy');
  });

  it('manifest returns an empty sheet for an uncast story (F1619)', () => {
    const repo = castingRepo(freshDb());
    const manifest = repo.castSheets.manifest('unknown');
    expect(manifest.storyId).toBe('unknown');
    expect(manifest.sheet.narrator).toBeNull();
    expect(manifest.sheet.bySpeaker).toEqual({});
  });
});
