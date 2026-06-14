/**
 * JSON canonical export target (F1475).
 *
 * Produces the HIGHEST-FIDELITY export of Fables notes — suitable for round-trip
 * import. All note fields are preserved verbatim; attachment bytes are written
 * content-addressed (deduplicated by hash).
 *
 * Output layout:
 *   fables-export.json            — JSON manifest (pretty-printed, 2-space)
 *   attachments/<hash>            — raw bytes for each unique attachment
 *
 * schema: fables-export/v1
 */

import {
  textFile,
  safeName as _safeName,
  type ExportTarget,
  type ExportNote,
  type ExportFile,
} from '../index.js';

/** Stable schema identifier embedded in every export manifest. */
export const JSON_EXPORT_SCHEMA = 'fables-export/v1';

// ── Schema types (documented for round-trip consumers) ──────────────────────

/**
 * The top-level export manifest written to `fables-export.json`.
 *
 * @field schema      - Always `"fables-export/v1"`. Bump the version if the shape breaks.
 * @field exportedAt  - ISO-8601 timestamp of when the export was produced.
 * @field notes       - Ordered array of all exported notes (see ExportNoteRecord).
 */
interface ExportManifest {
  schema: typeof JSON_EXPORT_SCHEMA;
  exportedAt: string;
  notes: ExportNoteRecord[];
}

/**
 * One note as stored in the manifest.
 *
 * @field id           - Unique note ID (UUID).
 * @field title        - Human-readable note title.
 * @field body         - Markdown body, exactly as stored in Fables.
 * @field notebookPath - Notebook hierarchy, outermost first (e.g. ["Work", "Projects"]).
 * @field tags         - Flat list of tag names.
 * @field createdAt    - ISO-8601 creation timestamp.
 * @field updatedAt    - ISO-8601 last-modified timestamp.
 * @field attachments  - Attachment metadata (bytes live in attachments/<hash>).
 */
interface ExportNoteRecord {
  id: string;
  title: string;
  body: string;
  notebookPath: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  attachments: ExportAttachmentRecord[];
}

/**
 * Attachment metadata stored in the manifest.
 *
 * @field id       - Unique attachment ID.
 * @field filename - Original filename.
 * @field mime     - MIME type (e.g. "image/png").
 * @field hash     - Content hash — also the filename under `attachments/`.
 */
interface ExportAttachmentRecord {
  id: string;
  filename: string;
  mime: string;
  hash: string;
}

// ── Exporter ─────────────────────────────────────────────────────────────────

export class JsonExporter implements ExportTarget {
  readonly name = 'json';

  export(notes: ExportNote[]): ExportFile[] {
    const files: ExportFile[] = [];
    const writtenHashes = new Set<string>();

    const noteRecords: ExportNoteRecord[] = notes.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      notebookPath: n.notebookPath,
      tags: n.tags,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      attachments: n.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mime: a.mime,
        hash: a.hash,
      })),
    }));

    // Write attachment bytes, deduplicated by hash.
    for (const note of notes) {
      for (const att of note.attachments) {
        if (!writtenHashes.has(att.hash)) {
          writtenHashes.add(att.hash);
          files.push({ path: `attachments/${att.hash}`, data: att.read() });
        }
      }
    }

    const manifest: ExportManifest = {
      schema: JSON_EXPORT_SCHEMA,
      exportedAt: new Date().toISOString(),
      notes: noteRecords,
    };

    files.unshift(textFile('fables-export.json', JSON.stringify(manifest, null, 2)));

    return files;
  }
}
