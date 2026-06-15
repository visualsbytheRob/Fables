import type { Migration } from './index.js';

/**
 * AI runtime depth (F1316–F1317).
 *
 *   ai_prompt_log       a local, inspectable log of prompt/response pairs. Off by
 *                       default (gated by AI settings); never auto-populated.
 *   ai_prompt_overrides user edits to the built-in prompt templates, keyed by
 *                       template id; the resolver layers these over the defaults.
 */
export const migration047AiRuntime: Migration = {
  id: 47,
  name: 'ai-runtime',
  sql: /* sql */ `
    CREATE TABLE ai_prompt_log (
      id          TEXT PRIMARY KEY,
      feature     TEXT NOT NULL,
      model       TEXT NOT NULL DEFAULT '',
      prompt      TEXT NOT NULL,
      response    TEXT NOT NULL,
      tokens      INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX idx_ai_prompt_log_created ON ai_prompt_log (created_at);

    CREATE TABLE ai_prompt_overrides (
      template_id TEXT PRIMARY KEY,
      template    TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `,
};
