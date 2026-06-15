/**
 * Voice casting repository (Epic 17, F1611/F1616/F1617/F1619).
 *
 * Two stores backing the casting feature:
 *   - `entityVoices`: a voice assignment per entity (character → voice) with
 *     optional per-character rate/pitch (F1611/F1615).
 *   - `castSheets`: a saved CastSheet per story, plus reusable templates
 *     (story_id null, F1617). The sheet is stored as one JSON document so its
 *     shape can evolve without further migrations; `manifest()` returns the
 *     serializable casting for a story (F1619).
 *
 * The CastSheet / VoiceAssignment shapes are owned by the pure resolver in
 * `audio/casting/resolve.ts`; this repo only persists them.
 */

import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';
import type { CastSheet, VoiceAssignment } from '../../audio/casting/resolve.js';

// ── Per-entity voices (F1611/F1615) ──────────────────────────────────────────

interface EntityVoiceRow {
  entity_id: string;
  voice_id: string;
  rate: number | null;
  pitch: number | null;
}

export interface EntityVoice extends VoiceAssignment {
  entityId: string;
}

const toEntityVoice = (r: EntityVoiceRow): EntityVoice => ({
  entityId: r.entity_id,
  voiceId: r.voice_id,
  ...(r.rate !== null ? { rate: r.rate } : {}),
  ...(r.pitch !== null ? { pitch: r.pitch } : {}),
});

// ── Cast sheets (F1616/F1617) ────────────────────────────────────────────────

interface CastSheetRow {
  id: string;
  story_id: string | null;
  name: string;
  data: string;
  created_at: string;
  updated_at: string;
}

export interface CastSheetRecord {
  id: string;
  /** null for a reusable template (F1617). */
  storyId: string | null;
  name: string;
  sheet: CastSheet;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_SHEET: CastSheet = { narrator: null, bySpeaker: {}, defaultCharacter: null };

function parseSheet(json: string): CastSheet {
  try {
    const v = JSON.parse(json) as Partial<CastSheet>;
    return {
      narrator: v.narrator ?? null,
      bySpeaker: v.bySpeaker ?? {},
      defaultCharacter: v.defaultCharacter ?? null,
    };
  } catch {
    return { ...EMPTY_SHEET };
  }
}

const toRecord = (r: CastSheetRow): CastSheetRecord => ({
  id: r.id,
  storyId: r.story_id,
  name: r.name,
  sheet: parseSheet(r.data),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const newCastId = (): string => `cast_${crypto.randomUUID()}`;

export interface CastSheetInput {
  storyId?: string | null;
  name?: string;
  sheet: CastSheet;
}

export function castingRepo(db: Db) {
  const entityVoices = {
    set(entityId: string, voice: VoiceAssignment): EntityVoice {
      const now = nowIso();
      db.prepare(
        `INSERT INTO entity_voices (entity_id, voice_id, rate, pitch, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(entity_id) DO UPDATE SET
           voice_id = excluded.voice_id,
           rate = excluded.rate,
           pitch = excluded.pitch,
           updated_at = excluded.updated_at`,
      ).run(entityId, voice.voiceId, voice.rate ?? null, voice.pitch ?? null, now, now);
      return { entityId, ...voice };
    },

    get(entityId: string): EntityVoice | null {
      const row = db.prepare('SELECT * FROM entity_voices WHERE entity_id = ?').get(entityId) as
        | EntityVoiceRow
        | undefined;
      return row ? toEntityVoice(row) : null;
    },

    list(): EntityVoice[] {
      return (
        db.prepare('SELECT * FROM entity_voices ORDER BY entity_id').all() as EntityVoiceRow[]
      ).map(toEntityVoice);
    },

    remove(entityId: string): boolean {
      return db.prepare('DELETE FROM entity_voices WHERE entity_id = ?').run(entityId).changes > 0;
    },
  };

  const castSheets = {
    create(input: CastSheetInput): CastSheetRecord {
      const now = nowIso();
      const rec: CastSheetRecord = {
        id: newCastId(),
        storyId: input.storyId ?? null,
        name: input.name ?? '',
        sheet: input.sheet,
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO cast_sheets (id, story_id, name, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(rec.id, rec.storyId, rec.name, JSON.stringify(rec.sheet), now, now);
      return rec;
    },

    get(id: string): CastSheetRecord | null {
      const row = db.prepare('SELECT * FROM cast_sheets WHERE id = ?').get(id) as
        | CastSheetRow
        | undefined;
      return row ? toRecord(row) : null;
    },

    forStory(storyId: string): CastSheetRecord | null {
      const row = db
        .prepare('SELECT * FROM cast_sheets WHERE story_id = ? ORDER BY updated_at DESC LIMIT 1')
        .get(storyId) as CastSheetRow | undefined;
      return row ? toRecord(row) : null;
    },

    /** Reusable templates (story_id null, F1617). */
    templates(): CastSheetRecord[] {
      return (
        db
          .prepare('SELECT * FROM cast_sheets WHERE story_id IS NULL ORDER BY name')
          .all() as CastSheetRow[]
      ).map(toRecord);
    },

    update(id: string, patch: { name?: string; sheet?: CastSheet }): CastSheetRecord | null {
      const current = this.get(id);
      if (!current) return null;
      const next: CastSheetRecord = {
        ...current,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.sheet !== undefined ? { sheet: patch.sheet } : {}),
        updatedAt: nowIso(),
      };
      db.prepare('UPDATE cast_sheets SET name = ?, data = ?, updated_at = ? WHERE id = ?').run(
        next.name,
        JSON.stringify(next.sheet),
        next.updatedAt,
        id,
      );
      return next;
    },

    remove(id: string): boolean {
      return db.prepare('DELETE FROM cast_sheets WHERE id = ?').run(id).changes > 0;
    },

    /** Serializable casting for a story's export manifest (F1619). */
    manifest(storyId: string): { storyId: string; sheet: CastSheet } {
      const rec = this.forStory(storyId);
      return { storyId, sheet: rec ? rec.sheet : { ...EMPTY_SHEET } };
    },
  };

  return { entityVoices, castSheets };
}

export type CastingRepo = ReturnType<typeof castingRepo>;
