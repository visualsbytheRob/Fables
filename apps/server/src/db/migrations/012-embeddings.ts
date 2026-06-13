import type { Migration } from './index.js';

/**
 * Day 8 Embeddings table (F721–F730).
 *
 * `embeddings` stores one row per (source_id, chunk_index, provider_id).
 * `chunk_hash` allows skipping re-embedding for unchanged chunks.
 * `vector` is stored as JSON text (a JSON array of floats) — no native ext required.
 *
 * Design notes:
 *   - pure-JS provider: vector is a compact JSON float array.
 *   - provider_id is stored so model-swap can re-embed just the rows for an old model.
 *   - (chunk_hash, provider_id) unique constraint prevents duplicates.
 */
export const migration012Embeddings: Migration = {
  id: 12,
  name: 'embeddings',
  sql: /* sql */ `
    CREATE TABLE embeddings (
      id           TEXT PRIMARY KEY,
      source_id    TEXT NOT NULL,
      source_type  TEXT NOT NULL DEFAULT 'note',
      chunk_index  INTEGER NOT NULL DEFAULT 0,
      chunk_hash   TEXT NOT NULL,
      provider_id  TEXT NOT NULL,
      vector       TEXT NOT NULL,  -- JSON array of floats
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE UNIQUE INDEX idx_embeddings_chunk_provider
      ON embeddings (chunk_hash, provider_id);

    CREATE INDEX idx_embeddings_source
      ON embeddings (source_id, source_type);

    CREATE INDEX idx_embeddings_provider
      ON embeddings (provider_id);
  `,
};
