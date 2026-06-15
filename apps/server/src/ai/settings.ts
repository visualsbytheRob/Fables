/**
 * AI settings & trust (F1391–F1395).
 *
 *   F1391  Settings document: per-feature toggles + backend preference.
 *   F1392  Global kill switch: one flag disables every AI feature.
 *   F1393  Data-use explainer: what context each feature actually sees.
 *   F1394  Per-notebook AI exclusions: private areas never feed any AI op.
 *   F1395  Secret content is invisible to AI: encrypted fields are never sent.
 *
 * Settings persist as one JSON row (migration 026); the kill switch is also
 * mirrored onto the AIRuntime so it short-circuits availability everywhere.
 */

import { isEncryptedField } from '@fables/core';
import type { Db } from '../db/connection.js';

// ── Settings document (F1391/F1392/F1394) ────────────────────────────────────

/** Feature keys the user can toggle independently (F1391). */
export const AI_FEATURES = [
  'rag',
  'noteIntelligence',
  'storyCowriter',
  'character',
  'actions',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export interface AiSettings {
  /** F1392: when true, every AI feature is off regardless of other toggles. */
  killSwitch: boolean;
  /** F1391: per-feature enable map; a missing key defaults to enabled. */
  featureToggles: Partial<Record<AiFeature, boolean>>;
  /** F1394: notebook ids excluded from ALL AI operations (local + cloud). */
  excludedNotebooks: string[];
  /** F1316: local prompt/response logging. OFF by default. */
  promptLogging?: boolean | undefined;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  killSwitch: false,
  featureToggles: {},
  excludedNotebooks: [],
  promptLogging: false,
};

/** Whether a feature may run under the current settings (F1391 + F1392). */
export function isFeatureEnabled(settings: AiSettings, feature: AiFeature): boolean {
  if (settings.killSwitch) return false;
  return settings.featureToggles[feature] ?? true;
}

/** Whether a notebook is walled off from all AI operations (F1394). */
export function isNotebookExcluded(settings: AiSettings, notebookId: string): boolean {
  return settings.excludedNotebooks.includes(notebookId);
}

// ── Persistence ──────────────────────────────────────────────────────────────

export function aiSettingsRepo(db: Db) {
  return {
    get(): AiSettings {
      const row = db.prepare('SELECT data FROM ai_settings WHERE id = 1').get() as
        | { data: string }
        | undefined;
      if (!row) return { ...DEFAULT_AI_SETTINGS };
      try {
        return { ...DEFAULT_AI_SETTINGS, ...(JSON.parse(row.data) as Partial<AiSettings>) };
      } catch {
        return { ...DEFAULT_AI_SETTINGS };
      }
    },

    save(settings: AiSettings): AiSettings {
      // Normalise: dedupe exclusions, keep only known feature keys.
      const normalised: AiSettings = {
        killSwitch: settings.killSwitch,
        featureToggles: Object.fromEntries(
          Object.entries(settings.featureToggles).filter(([k]) =>
            (AI_FEATURES as readonly string[]).includes(k),
          ),
        ),
        excludedNotebooks: [...new Set(settings.excludedNotebooks)],
        promptLogging: settings.promptLogging ?? false,
      };
      db.prepare(
        `INSERT INTO ai_settings (id, data) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      ).run(JSON.stringify(normalised));
      return normalised;
    },
  };
}

export type AiSettingsRepo = ReturnType<typeof aiSettingsRepo>;

// ── Secret-content guard (F1395) ─────────────────────────────────────────────

export interface MaybeSecretNote {
  id: string;
  title: string;
  body: string;
  notebookId?: string | undefined;
}

/**
 * Whether a note may be shown to AI (F1395). Encrypted/secret content — a field
 * still in its at-rest `enc:v1:` form (e.g. a locked vault) — is never visible.
 * This is the hard wall: secret notes can't leak into a prompt even by accident.
 */
export function isAiVisible(note: { title: string; body: string }): boolean {
  return !isEncryptedField(note.body) && !isEncryptedField(note.title);
}

/**
 * Filter a set of notes down to those AI is allowed to see, honouring both the
 * encrypted-content wall (F1395) and per-notebook exclusions (F1394).
 */
export function filterAiVisible<T extends MaybeSecretNote>(notes: T[], settings: AiSettings): T[] {
  return notes.filter(
    (n) =>
      isAiVisible(n) && !(n.notebookId !== undefined && isNotebookExcluded(settings, n.notebookId)),
  );
}

// ── Data-use explainer (F1393) ───────────────────────────────────────────────

export interface DataUseEntry {
  feature: AiFeature;
  /** Plain-language description of what context this feature sends to a model. */
  sees: string;
  /** Whether the feature can use the cloud backend at all. */
  cloudCapable: boolean;
}

/** What each feature actually sees — shown verbatim in the data-use explainer (F1393). */
export const DATA_USE: readonly DataUseEntry[] = [
  {
    feature: 'rag',
    sees: 'The text of notes retrieved as relevant to your question, plus the question itself.',
    cloudCapable: true,
  },
  {
    feature: 'noteIntelligence',
    sees: 'The title and body of the single note you run the action on.',
    cloudCapable: true,
  },
  {
    feature: 'storyCowriter',
    sees: 'The scene/outline text you provide and any captured style — never your whole vault.',
    cloudCapable: true,
  },
  {
    feature: 'character',
    sees: 'The character sheet, facts, or transcript you provide for that action.',
    cloudCapable: true,
  },
  {
    feature: 'actions',
    sees: 'The selection or note body bound to the action you run.',
    cloudCapable: true,
  },
];
