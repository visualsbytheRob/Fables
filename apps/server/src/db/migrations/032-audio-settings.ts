import type { Migration } from './index.js';

/**
 * Audio mixing + soundscape settings (Epic 17, F1638/F1632).
 *
 * One JSON row holds the per-vault mix levels (narration/ambient/effects/master)
 * and any manual scene→soundscape overrides that supplement the `# scene:` tags
 * extracted from story source. Stored as a document so the shape can grow
 * without further migrations.
 */
export const migration032AudioSettings: Migration = {
  id: 32,
  name: 'audio-settings',
  sql: /* sql */ `
    CREATE TABLE audio_settings (
      id   INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );
  `,
};
