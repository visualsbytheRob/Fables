/**
 * Per-vault audio settings (Epic 17, F1638/F1632).
 *
 * One JSON row (migration 032) holds the mix levels and any manual
 * scene→soundscape overrides that supplement the `# scene:` tags extracted from
 * story source. The overrides map a scene/soundscape name to a bundled library
 * sound id, letting the reader re-skin a story's ambience without editing it.
 */

import type { Db } from '../../db/connection.js';
import { DEFAULT_MIX, normalizeMix, type MixLevels } from './mixer.js';

export interface AudioSettings {
  mix: MixLevels;
  /** scene/soundscape name → library sound id override. */
  sceneOverrides: Record<string, string>;
  /** Ambient ducking amount while narration plays, 0–1 (F1633). */
  duckAmount: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  mix: { ...DEFAULT_MIX },
  sceneOverrides: {},
  duckAmount: 0.6,
};

export function audioSettingsRepo(db: Db) {
  return {
    get(): AudioSettings {
      const row = db.prepare('SELECT data FROM audio_settings WHERE id = 1').get() as
        | { data: string }
        | undefined;
      if (!row) return { ...DEFAULT_AUDIO_SETTINGS, mix: { ...DEFAULT_MIX } };
      try {
        const parsed = JSON.parse(row.data) as Partial<AudioSettings>;
        return {
          mix: normalizeMix(parsed.mix ?? {}),
          sceneOverrides: parsed.sceneOverrides ?? {},
          duckAmount: parsed.duckAmount ?? DEFAULT_AUDIO_SETTINGS.duckAmount,
        };
      } catch {
        return { ...DEFAULT_AUDIO_SETTINGS, mix: { ...DEFAULT_MIX } };
      }
    },

    update(patch: {
      mix?: { [K in keyof MixLevels]?: MixLevels[K] | undefined } | undefined;
      sceneOverrides?: Record<string, string> | undefined;
      duckAmount?: number | undefined;
    }): AudioSettings {
      const current = this.get();
      const next: AudioSettings = {
        mix: patch.mix !== undefined ? normalizeMix({ ...current.mix, ...patch.mix }) : current.mix,
        sceneOverrides: patch.sceneOverrides ?? current.sceneOverrides,
        duckAmount: patch.duckAmount ?? current.duckAmount,
      };
      db.prepare(
        `INSERT INTO audio_settings (id, data) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      ).run(JSON.stringify(next));
      return next;
    },
  };
}
