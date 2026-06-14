/**
 * Mapping engine (F1402): turns the staging IR into Fables-model decisions under
 * a set of serializable rule values. Pure functions — no DB, no I/O — so the
 * mapping policy is independently testable and rule files are just data.
 */

import type { NotebookId } from '@fables/core';
import { isValidTagName, normalizeTagName } from '../../lib/hashtags.js';
import type { MappingRules, StagedDoc } from './types.js';

/** The notebook segments a doc maps to, after applying the `notebooks` rule (F1402). */
export function notebookSegments(doc: StagedDoc, rules: MappingRules): string[] {
  if (rules.notebooks === 'flat') return [];
  return doc.notebookPath.filter((s) => s.trim() !== '');
}

/** Human-readable notebook label for reports (root when empty). */
export function notebookLabel(segments: string[]): string {
  return segments.length === 0 ? '(root)' : segments.join(' / ');
}

/** Normalize + prefix + validate a doc's tags under the rules (F1402). */
export function mappedTags(doc: StagedDoc, rules: MappingRules): string[] {
  const out: string[] = [];
  for (const raw of doc.tags) {
    const prefixed = rules.tagPrefix ? `${rules.tagPrefix}${raw}` : raw;
    const name = normalizeTagName(prefixed);
    if (name !== '' && isValidTagName(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Loose shape accepted from rule files / request bodies (ids are plain strings). */
export interface RawRules {
  notebooks?: 'preserve' | 'flat' | undefined;
  tagPrefix?: string | undefined;
  collisions?: 'skip' | 'rename' | 'merge' | undefined;
  rootNotebookId?: string | undefined;
}

/** Validate a rules object loaded from a file/request, falling back to safe defaults. */
export function normalizeRules(partial: RawRules | undefined): MappingRules {
  const notebooks = partial?.notebooks === 'flat' ? 'flat' : 'preserve';
  const collisions =
    partial?.collisions === 'skip' || partial?.collisions === 'merge'
      ? partial.collisions
      : 'rename';
  return {
    notebooks,
    collisions,
    ...(partial?.tagPrefix ? { tagPrefix: partial.tagPrefix } : {}),
    ...(partial?.rootNotebookId ? { rootNotebookId: partial.rootNotebookId as NotebookId } : {}),
  };
}
