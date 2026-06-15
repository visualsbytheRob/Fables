import type { Migration } from './index.js';

/**
 * Generated art assets (Epic 19, F1868).
 *
 * Content-addressed store for generated (or typographic-fallback) images, keyed
 * by sha256, with provenance: which adapter produced it, the prompt, the asset
 * kind (cover/portrait/scene) and the subject it belongs to. Re-generating
 * identical bytes dedupes.
 */
export const migration039GeneratedAssets: Migration = {
  id: 39,
  name: 'generated-assets',
  sql: /* sql */ `
    CREATE TABLE generated_assets (
      hash       TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      subject_id TEXT NOT NULL DEFAULT '',
      format     TEXT NOT NULL,
      bytes      INTEGER NOT NULL,
      data       BLOB NOT NULL,
      adapter    TEXT NOT NULL,
      prompt     TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_generated_assets_subject ON generated_assets (kind, subject_id);
  `,
};
