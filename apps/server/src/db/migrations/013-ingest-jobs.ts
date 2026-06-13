import type { Migration } from './index.js';

/**
 * Ingestion job tracking (F761–F790).
 *
 * `ingest_jobs`: one row per document ingestion run (PDF, EPUB, HTML/URL).
 *   - source_type: 'pdf' | 'epub' | 'html' | 'url' | 'audio'
 *   - status: 'queued' | 'running' | 'done' | 'failed'
 *   - result_note_id: the note created (or null if failed / not yet done)
 *   - progress / total: page or chapter counts for UI polling
 *   - error: human-readable error string when status='failed'
 *   - metadata: JSON blob — source URL, site name, favicon, etc.
 *
 * `transcription_jobs`: one row per audio transcription request.
 *   - status: 'queued' | 'running' | 'done' | 'failed'
 *   - attachment_id: FK → attachments.id (audio file)
 *   - note_id: created transcript note (null until done)
 *   - model_size: 'tiny' | 'base' | 'small' | 'medium' | 'large' (F789)
 *   - retry_count: incremented on each retry attempt
 *   - error: last error message when failed
 *   - result: JSON transcript with timestamped segments (F784)
 */
export const migration013IngestJobs: Migration = {
  id: 13,
  name: 'ingest-jobs',
  sql: /* sql */ `
    CREATE TABLE ingest_jobs (
      id             TEXT PRIMARY KEY,
      source_type    TEXT NOT NULL CHECK (source_type IN ('pdf','epub','html','url','audio')),
      source_name    TEXT NOT NULL DEFAULT '',
      status         TEXT NOT NULL CHECK (status IN ('queued','running','done','failed'))
                     DEFAULT 'queued',
      total          INTEGER NOT NULL DEFAULT 0,
      progress       INTEGER NOT NULL DEFAULT 0,
      result_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
      attachment_id  TEXT REFERENCES attachments(id) ON DELETE SET NULL,
      error          TEXT,
      metadata       TEXT NOT NULL DEFAULT '{}',
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX idx_ingest_jobs_status ON ingest_jobs (status, created_at DESC);

    CREATE TABLE transcription_jobs (
      id             TEXT PRIMARY KEY,
      attachment_id  TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
      note_id        TEXT REFERENCES notes(id) ON DELETE SET NULL,
      status         TEXT NOT NULL CHECK (status IN ('queued','running','done','failed'))
                     DEFAULT 'queued',
      model_size     TEXT NOT NULL DEFAULT 'base',
      retry_count    INTEGER NOT NULL DEFAULT 0,
      error          TEXT,
      result         TEXT,
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX idx_transcription_jobs_status ON transcription_jobs (status, created_at DESC);
    CREATE INDEX idx_transcription_jobs_attachment ON transcription_jobs (attachment_id);
  `,
};
