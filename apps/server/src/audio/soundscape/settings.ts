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
  /** Downmix everything to mono (accessibility, F1687). */
  mono: boolean;
  /** Stereo balance, -1 (full left) … 0 (center) … 1 (full right) (F1687). */
  balance: number;
  /** Normalize loudness across voices so no narrator is jarringly louder (F1686). */
  normalizeVoices: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  mix: { ...DEFAULT_MIX },
  sceneOverrides: {},
  duckAmount: 0.6,
  mono: false,
  balance: 0,
  normalizeVoices: true,
};

const clampBalance = (n: number): number => (n < -1 ? -1 : n > 1 ? 1 : n);

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
          mono: parsed.mono ?? DEFAULT_AUDIO_SETTINGS.mono,
          balance: clampBalance(parsed.balance ?? DEFAULT_AUDIO_SETTINGS.balance),
          normalizeVoices: parsed.normalizeVoices ?? DEFAULT_AUDIO_SETTINGS.normalizeVoices,
        };
      } catch {
        return { ...DEFAULT_AUDIO_SETTINGS, mix: { ...DEFAULT_MIX } };
      }
    },

    update(patch: {
      mix?: { [K in keyof MixLevels]?: MixLevels[K] | undefined } | undefined;
      sceneOverrides?: Record<string, string> | undefined;
      duckAmount?: number | undefined;
      mono?: boolean | undefined;
      balance?: number | undefined;
      normalizeVoices?: boolean | undefined;
    }): AudioSettings {
      const current = this.get();
      const next: AudioSettings = {
        mix: patch.mix !== undefined ? normalizeMix({ ...current.mix, ...patch.mix }) : current.mix,
        sceneOverrides: patch.sceneOverrides ?? current.sceneOverrides,
        duckAmount: patch.duckAmount ?? current.duckAmount,
        mono: patch.mono ?? current.mono,
        balance: patch.balance !== undefined ? clampBalance(patch.balance) : current.balance,
        normalizeVoices: patch.normalizeVoices ?? current.normalizeVoices,
      };
      db.prepare(
        `INSERT INTO audio_settings (id, data) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      ).run(JSON.stringify(next));
      return next;
    },
  };
}
