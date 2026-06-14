import type { Migration } from './index.js';

/**
 * User-defined AI actions (F1377).
 *
 * A custom action is a saved prompt + scope the user can run from the command
 * surface. The template body references a single `{{input}}` slot (the selection
 * or note body); `task` drives the determinism/speed preset; `output` selects
 * free-text vs JSON handling.
 *
 *   scope   — 'selection' | 'note' (what `{{input}}` is bound to)
 *   task    — an AiTask key (tags|title|summary|qa|prose|dialogue)
 *   output  — 'text' | 'json'
 */
export const migration025AiActions: Migration = {
  id: 25,
  name: 'ai-actions',
  sql: /* sql */ `
    CREATE TABLE ai_actions (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system      TEXT,
      template    TEXT NOT NULL,
      task        TEXT NOT NULL,
      scope       TEXT NOT NULL DEFAULT 'selection',
      output      TEXT NOT NULL DEFAULT 'text',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `,
};
