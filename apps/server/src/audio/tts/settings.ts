/**
 * Per-vault voice settings (F1608).
 *
 * One JSON row (migration 030) holds the reader's defaults: preferred voice,
 * speaking rate and pitch, whether speech is globally disabled, a soft cache
 * budget, and the pronunciation-lexicon source (F1605) the synthesis pipeline
 * applies before handing text to an engine.
 */

import type { Db } from '../../db/connection.js';

export interface TtsSettings {
  /** Engine voice id to use when a request doesn't name one. */
  defaultVoiceId: string | null;
  /** Speaking rate multiplier, 1 = normal. */
  rate: number;
  /** Pitch multiplier, 1 = normal. */
  pitch: number;
  /** When true, the runtime is globally disabled (no synthesis anywhere). */
  disabled: boolean;
  /** Soft cap on the audio cache in megabytes. */
  cacheBudgetMb: number;
  /** Pronunciation lexicon source (parseLexicon format, F1605). */
  lexicon: string;
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  defaultVoiceId: null,
  rate: 1,
  pitch: 1,
  disabled: false,
  cacheBudgetMb: 200,
  lexicon: '',
};

export function ttsSettingsRepo(db: Db) {
  return {
    get(): TtsSettings {
      const row = db.prepare('SELECT data FROM tts_settings WHERE id = 1').get() as
        | { data: string }
        | undefined;
      if (!row) return { ...DEFAULT_TTS_SETTINGS };
      try {
        return { ...DEFAULT_TTS_SETTINGS, ...(JSON.parse(row.data) as Partial<TtsSettings>) };
      } catch {
        return { ...DEFAULT_TTS_SETTINGS };
      }
    },

    update(patch: { [K in keyof TtsSettings]?: TtsSettings[K] | undefined }): TtsSettings {
      const next = { ...this.get() };
      // Only copy keys the caller actually set; skip explicit undefined so we
      // never clobber a default (exactOptionalPropertyTypes).
      for (const key of Object.keys(patch) as (keyof TtsSettings)[]) {
        const value = patch[key];
        if (value !== undefined) (next[key] as TtsSettings[typeof key]) = value;
      }
      db.prepare(
        `INSERT INTO tts_settings (id, data) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      ).run(JSON.stringify(next));
      return next;
    },
  };
}
