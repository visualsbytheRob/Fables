import type { Migration } from './index.js';

/**
 * AI token-usage meter (F1367).
 *
 * Records token usage per feature and per calendar month so the user can see a
 * local monthly meter for any cloud backend — entirely on-device, never synced.
 * One row per (month, feature, backend); counts accumulate via upsert.
 *
 *   month   — 'YYYY-MM' bucket (local time at record-time)
 *   feature — the AiTask or feature key that drove the call
 *   backend — adapter name ('claude', 'ollama', …)
 */
export const migration024AiUsage: Migration = {
  id: 24,
  name: 'ai-usage',
  sql: /* sql */ `
    CREATE TABLE ai_usage (
      month        TEXT NOT NULL,
      feature      TEXT NOT NULL,
      backend      TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      calls        INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT NOT NULL,
      PRIMARY KEY (month, feature, backend)
    );
  `,
};
