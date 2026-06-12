import type { Migration } from './index.js';

/**
 * Wikilink/mention support on the links table (F202, F206, F207, F208, F221).
 *
 * - `target_title`   JS-lowercased title text the source wrote — kept for every
 *                    row so unresolved links can re-resolve when a note with
 *                    that title appears, and so mentions index by title.
 * - `target_heading` heading part of `[[note#heading]]` links.
 * - `target_block`   block id part of `[[note^blockid]]` links.
 * - `length`         match length in the source body (snippets, conversions).
 * - `broken`         1 when the target title resolves to no live note; such
 *                    rows keep `target_id = ''`.
 */
export const migration005Links: Migration = {
  id: 5,
  name: 'links',
  sql: /* sql */ `
    ALTER TABLE links ADD COLUMN target_title TEXT NOT NULL DEFAULT '';
    ALTER TABLE links ADD COLUMN target_heading TEXT;
    ALTER TABLE links ADD COLUMN target_block TEXT;
    ALTER TABLE links ADD COLUMN length INTEGER;
    ALTER TABLE links ADD COLUMN broken INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX idx_links_kind_title ON links(kind, target_title);
    CREATE INDEX idx_links_kind_target ON links(kind, target_id);
  `,
};
