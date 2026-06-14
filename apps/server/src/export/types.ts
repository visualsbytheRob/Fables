/**
 * Export framework — the public contract (F1471, mirroring the import framework).
 *
 * Symmetry with import: where an importer turns a foreign format into the staging
 * IR, an **export target** turns Fables notes into a foreign format. The framework
 * harvests notes (all, by notebook, or by an FQL query — F1478) into the
 * `ExportNote` IR and hands them to a target, which returns the files to write.
 * The framework owns harvesting, bundling (directory or `.zip`), and the registry,
 * so each target stays a small, pure serializer.
 */

export interface ExportAttachment {
  id: string;
  filename: string;
  mime: string;
  /** Content hash (the on-disk, content-addressed name). */
  hash: string;
  /** Read the attachment bytes from the store. */
  read(): Buffer;
}

/** One note, fully resolved for export (the reverse of import's StagedDoc). */
export interface ExportNote {
  id: string;
  title: string;
  /** Markdown body, exactly as stored. */
  body: string;
  /** Notebook hierarchy, outermost first. */
  notebookPath: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  attachments: ExportAttachment[];
}

/** A single file in the export bundle, at a POSIX-relative path. */
export interface ExportFile {
  path: string;
  data: Buffer;
}

export interface ExportTarget {
  /** Stable target name recorded in the bundle / surfaced by the registry. */
  readonly name: string;
  /** Serialize the harvested notes into bundle files. */
  export(notes: ExportNote[]): ExportFile[] | Promise<ExportFile[]>;
}

export interface ExportResult {
  target: string;
  notes: number;
  files: number;
  bytes: number;
  /** Server-local directory the bundle was written to (when writing to disk). */
  path?: string;
}

// ── Small helpers shared by targets ──────────────────────────────────────────

/** Make a UTF-8 text ExportFile. */
export function textFile(path: string, content: string): ExportFile {
  return { path, data: Buffer.from(content, 'utf8') };
}

/** Filesystem-safe version of a title/segment for use as a file or folder name. */
export function safeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|-]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? 'Untitled' : cleaned.slice(0, 120);
}
