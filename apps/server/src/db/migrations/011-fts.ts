import type { Migration } from './index.js';

/**
 * Day 8 FTS5 full-text search (F701–F710).
 *
 * Three content-backed FTS5 virtual tables:
 *   - fts_notes     over notes(title, body)     — id UNINDEXED
 *   - fts_scenes    over scenes(path, source)   — id UNINDEXED
 *   - fts_entities  over entities(name, aliases, fields) — id UNINDEXED
 *
 * Porter + unicode61 tokenizer for multi-language stemming.
 *
 * Trigger convention: for content= tables every INSERT/UPDATE/DELETE must be
 * mirrored exactly — the delete command receives OLD values, the insert
 * receives NEW values.  **Never use a conditional (SELECT WHERE) inside the
 * trigger body** — it causes SQLITE_CORRUPT_VTAB when the row moves between
 * "included" and "excluded" states (e.g. trash/restore).  Trashed notes are
 * excluded at query time by joining back to the live-notes constraint.
 *
 * Seeds from existing rows on migration apply.
 */
export const migration011Fts: Migration = {
  id: 11,
  name: 'fts',
  sql: /* sql */ `
    -- ── notes FTS ────────────────────────────────────────────────────────────
    CREATE VIRTUAL TABLE fts_notes USING fts5(
      title,
      body,
      id UNINDEXED,
      tokenize = 'porter unicode61',
      content = 'notes',
      content_rowid = 'rowid'
    );

    -- Seed ALL notes (trashed excluded at query time via JOIN)
    INSERT INTO fts_notes (rowid, title, body, id)
      SELECT rowid, title, body, id FROM notes;

    CREATE TRIGGER fts_notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO fts_notes (rowid, title, body, id)
        VALUES (NEW.rowid, NEW.title, NEW.body, NEW.id);
    END;

    CREATE TRIGGER fts_notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO fts_notes (fts_notes, rowid, title, body, id)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.body, OLD.id);
      INSERT INTO fts_notes (rowid, title, body, id)
        VALUES (NEW.rowid, NEW.title, NEW.body, NEW.id);
    END;

    CREATE TRIGGER fts_notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO fts_notes (fts_notes, rowid, title, body, id)
        VALUES ('delete', OLD.rowid, OLD.title, OLD.body, OLD.id);
    END;

    -- ── scenes FTS ───────────────────────────────────────────────────────────
    CREATE VIRTUAL TABLE fts_scenes USING fts5(
      path,
      source,
      id UNINDEXED,
      tokenize = 'porter unicode61',
      content = 'scenes',
      content_rowid = 'rowid'
    );

    INSERT INTO fts_scenes (rowid, path, source, id)
      SELECT rowid, path, source, id FROM scenes;

    CREATE TRIGGER fts_scenes_ai AFTER INSERT ON scenes BEGIN
      INSERT INTO fts_scenes (rowid, path, source, id)
        VALUES (NEW.rowid, NEW.path, NEW.source, NEW.id);
    END;

    CREATE TRIGGER fts_scenes_au AFTER UPDATE ON scenes BEGIN
      INSERT INTO fts_scenes (fts_scenes, rowid, path, source, id)
        VALUES ('delete', OLD.rowid, OLD.path, OLD.source, OLD.id);
      INSERT INTO fts_scenes (rowid, path, source, id)
        VALUES (NEW.rowid, NEW.path, NEW.source, NEW.id);
    END;

    CREATE TRIGGER fts_scenes_ad AFTER DELETE ON scenes BEGIN
      INSERT INTO fts_scenes (fts_scenes, rowid, path, source, id)
        VALUES ('delete', OLD.rowid, OLD.path, OLD.source, OLD.id);
    END;

    -- ── entities FTS ─────────────────────────────────────────────────────────
    CREATE VIRTUAL TABLE fts_entities USING fts5(
      name,
      aliases,
      fields,
      id UNINDEXED,
      tokenize = 'porter unicode61',
      content = 'entities',
      content_rowid = 'rowid'
    );

    INSERT INTO fts_entities (rowid, name, aliases, fields, id)
      SELECT rowid, name, aliases, fields, id FROM entities;

    CREATE TRIGGER fts_entities_ai AFTER INSERT ON entities BEGIN
      INSERT INTO fts_entities (rowid, name, aliases, fields, id)
        VALUES (NEW.rowid, NEW.name, NEW.aliases, NEW.fields, NEW.id);
    END;

    CREATE TRIGGER fts_entities_au AFTER UPDATE ON entities BEGIN
      INSERT INTO fts_entities (fts_entities, rowid, name, aliases, fields, id)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.aliases, OLD.fields, OLD.id);
      INSERT INTO fts_entities (rowid, name, aliases, fields, id)
        VALUES (NEW.rowid, NEW.name, NEW.aliases, NEW.fields, NEW.id);
    END;

    CREATE TRIGGER fts_entities_ad AFTER DELETE ON entities BEGIN
      INSERT INTO fts_entities (fts_entities, rowid, name, aliases, fields, id)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.aliases, OLD.fields, OLD.id);
    END;
  `,
};
