/**
 * AI settings & trust tests (F1391–F1395): per-feature toggles + kill switch,
 * per-notebook exclusions, the secret-content wall, data-use explainer, and the
 * kill switch's effect on the live runtime.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { AIRuntime } from './runtime.js';
import { toModelInfo } from './model-registry.js';
import {
  aiSettingsRepo,
  DATA_USE,
  DEFAULT_AI_SETTINGS,
  filterAiVisible,
  isAiVisible,
  isFeatureEnabled,
  isNotebookExcluded,
} from './settings.js';
import type {
  GenerateRequest,
  GenerateResponse,
  LanguageModelAdapter,
  ModelInfo,
} from './adapter.js';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
});
afterEach(() => db.close());

describe('feature toggles + kill switch (F1391/F1392)', () => {
  it('features default to enabled', () => {
    expect(isFeatureEnabled(DEFAULT_AI_SETTINGS, 'rag')).toBe(true);
  });

  it('an explicit toggle disables one feature', () => {
    const s = { ...DEFAULT_AI_SETTINGS, featureToggles: { rag: false } };
    expect(isFeatureEnabled(s, 'rag')).toBe(false);
    expect(isFeatureEnabled(s, 'character')).toBe(true);
  });

  it('the kill switch disables everything (F1392)', () => {
    const s = { ...DEFAULT_AI_SETTINGS, killSwitch: true, featureToggles: { rag: true } };
    expect(isFeatureEnabled(s, 'rag')).toBe(false);
    expect(isFeatureEnabled(s, 'actions')).toBe(false);
  });
});

describe('persistence + normalisation', () => {
  it('round-trips settings and dedupes/filters on save', () => {
    const repo = aiSettingsRepo(db);
    expect(repo.get()).toEqual(DEFAULT_AI_SETTINGS);
    const saved = repo.save({
      killSwitch: true,
      featureToggles: { rag: false, bogus: true } as never,
      excludedNotebooks: ['nb_1', 'nb_1', 'nb_2'],
    });
    expect(saved.excludedNotebooks).toEqual(['nb_1', 'nb_2']);
    expect(saved.featureToggles).toEqual({ rag: false }); // 'bogus' dropped
    expect(repo.get().killSwitch).toBe(true);
  });
});

describe('per-notebook exclusions (F1394)', () => {
  it('reports excluded notebooks', () => {
    const s = { ...DEFAULT_AI_SETTINGS, excludedNotebooks: ['nb_secret'] };
    expect(isNotebookExcluded(s, 'nb_secret')).toBe(true);
    expect(isNotebookExcluded(s, 'nb_open')).toBe(false);
  });
});

describe('secret-content wall (F1395)', () => {
  it('treats plaintext notes as visible', () => {
    expect(isAiVisible({ title: 'Plan', body: 'buy milk' })).toBe(true);
  });

  it('treats encrypted fields as invisible to AI', () => {
    // A field still in its at-rest `enc:v1:` form (e.g. a locked vault).
    expect(isAiVisible({ title: 'Plan', body: 'enc:v1:opaque-ciphertext' })).toBe(false);
  });

  it('filters out secret notes and excluded notebooks together', () => {
    const notes = [
      { id: 'n1', title: 'open', body: 'visible', notebookId: 'nb_a' },
      { id: 'n2', title: 'sealed', body: 'enc:v1:opaque', notebookId: 'nb_a' },
      { id: 'n3', title: 'walled', body: 'plain', notebookId: 'nb_excluded' },
    ];
    const settings = { ...DEFAULT_AI_SETTINGS, excludedNotebooks: ['nb_excluded'] };
    const visible = filterAiVisible(notes, settings);
    expect(visible.map((n) => n.id)).toEqual(['n1']);
  });
});

describe('data-use explainer (F1393)', () => {
  it('describes every feature', () => {
    expect(DATA_USE.length).toBeGreaterThanOrEqual(5);
    for (const e of DATA_USE) expect(e.sees.length).toBeGreaterThan(10);
  });
});

describe('kill switch on the live runtime (F1392)', () => {
  class MockAdapter implements LanguageModelAdapter {
    readonly name = 'mock';
    async isAvailable() {
      return true;
    }
    async listModels(): Promise<ModelInfo[]> {
      return [toModelInfo('llama3.1:8b')];
    }
    async generate(req: GenerateRequest): Promise<GenerateResponse> {
      return { text: `echo:${req.prompt}`, model: 'mock' };
    }
  }

  it('engaging the kill switch makes the runtime unavailable', async () => {
    const rt = new AIRuntime().register(new MockAdapter());
    expect(await rt.isAvailable()).toBe(true);
    rt.setKillSwitch(true);
    expect(rt.isKilled).toBe(true);
    expect(await rt.isAvailable()).toBe(false);
    expect(await rt.listModels()).toEqual([]);
    rt.setKillSwitch(false);
    expect(await rt.isAvailable()).toBe(true);
  });
});
