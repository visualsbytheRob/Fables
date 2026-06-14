/**
 * Import framework — the public contract (F1401 adapter interface, F1409 SDK).
 *
 * Every importer (Notion, Apple Notes, Evernote, Roam/Logseq, plus any plugin)
 * does exactly one job: parse its source into the **staging IR** below. The
 * framework owns everything after that — mapping, asset dedupe/relinking,
 * collision handling, link reconstruction, provenance, persistence, rollback —
 * so each source adapter stays small and every importer behaves consistently.
 */

import type { NotebookId } from '@fables/core';

// ── Staging IR (F1401) ───────────────────────────────────────────────────────

/** A binary asset referenced by a document, resolved lazily so big files aren't all held in memory. */
export interface StagedAsset {
  /** Token used in the body where this asset is referenced (e.g. a placeholder or original URL). */
  ref: string;
  filename: string;
  mime?: string | undefined;
  /** Returns the bytes; called once, at materialization time. */
  read(): Promise<Uint8Array> | Uint8Array;
}

/** A reference from one document to another, by the *source's* stable id. */
export interface StagedLink {
  /** Source id of the target document. */
  targetSourceId: string;
  /** Optional display text for the rendered wikilink. */
  label?: string | undefined;
}

/** One normalized document produced by a source adapter — the unit of import. */
export interface StagedDoc {
  /** Stable id from the source. Used for link resolution, resume, and provenance. */
  sourceId: string;
  title: string;
  /** Markdown body. May contain `{{asset:ref}}` and `{{link:targetSourceId}}` placeholders. */
  body: string;
  /** Notebook hierarchy this doc belongs under (outermost first). */
  notebookPath: string[];
  tags: string[];
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  assets: StagedAsset[];
  links: StagedLink[];
  /** Source-specific extras (kept on provenance, never lost). */
  metadata?: Record<string, unknown> | undefined;
}

// ── Source adapter (F1401/F1409) ─────────────────────────────────────────────

export interface SourceAdapter {
  /** Stable source name recorded on provenance: 'notion' | 'evernote' | … */
  readonly name: string;
  /** Parse the source into the staging IR. May be async (file/network reads). */
  stage(): Promise<StagedDoc[]> | StagedDoc[];
}

// ── Mapping rules (F1402) ────────────────────────────────────────────────────

/** Serializable rules controlling how staged docs map onto the Fables model. */
export interface MappingRules {
  /** How notebooks are derived from each doc's `notebookPath` (F1402). */
  notebooks: 'preserve' | 'flat';
  /** Optional prefix applied to every imported tag (e.g. 'notion/'). */
  tagPrefix?: string | undefined;
  /** Collision strategy when an imported title already exists. */
  collisions: 'skip' | 'rename' | 'merge';
  /** Root notebook everything imports under; a new one is made when absent. */
  rootNotebookId?: NotebookId | undefined;
}

export const DEFAULT_MAPPING_RULES: MappingRules = {
  notebooks: 'preserve',
  collisions: 'rename',
};

// ── Reports & results ────────────────────────────────────────────────────────

/** Per-doc line in a dry-run report (F1401) — what *would* happen, no writes. */
export interface DryRunDoc {
  sourceId: string;
  title: string;
  notebook: string;
  tags: number;
  assets: number;
  links: number;
  collision: boolean;
  /** Aspects that would not map cleanly (F1418-style lossiness). */
  lossy: string[];
}

export interface DryRunReport {
  source: string;
  docs: DryRunDoc[];
  totals: {
    docs: number;
    assets: number;
    links: number;
    collisions: number;
    lossy: number;
  };
}

export interface ImportResult {
  batchId: string;
  source: string;
  imported: number;
  merged: number;
  renamed: number;
  skipped: number;
  assets: number;
  linksResolved: number;
  errors: { sourceId: string; message: string }[];
}
