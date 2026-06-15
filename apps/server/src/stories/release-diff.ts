/**
 * Story release diffing (Epic 19, F1842/F1843/F1844).
 *
 * Pure comparison of two story snapshots (path → .fable source), used to generate
 * changelogs between releases, a narrative diff, and a save-compatibility check
 * (saves break when a knot they could point at is removed or renamed away).
 */

export type FileMap = Record<string, string>;

/** Knot names declared in a .fable source (`=== name ===`). */
export function knotsIn(source: string): string[] {
  const out: string[] = [];
  const re = /^===\s*([A-Za-z_][A-Za-z0-9_]*)\s*===/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]!);
  return out;
}

function allKnots(files: FileMap): Set<string> {
  const set = new Set<string>();
  for (const src of Object.values(files)) for (const k of knotsIn(src)) set.add(k);
  return set;
}

export interface ReleaseDiff {
  addedFiles: string[];
  removedFiles: string[];
  changedFiles: string[];
  addedKnots: string[];
  removedKnots: string[];
}

/** Structural diff between two release snapshots (F1844). */
export function diffReleases(oldFiles: FileMap, newFiles: FileMap): ReleaseDiff {
  const oldNames = new Set(Object.keys(oldFiles));
  const newNames = new Set(Object.keys(newFiles));
  const addedFiles = [...newNames].filter((n) => !oldNames.has(n)).sort();
  const removedFiles = [...oldNames].filter((n) => !newNames.has(n)).sort();
  const changedFiles = [...newNames]
    .filter((n) => oldNames.has(n) && oldFiles[n] !== newFiles[n])
    .sort();

  const oldKnots = allKnots(oldFiles);
  const newKnots = allKnots(newFiles);
  const addedKnots = [...newKnots].filter((k) => !oldKnots.has(k)).sort();
  const removedKnots = [...oldKnots].filter((k) => !newKnots.has(k)).sort();

  return { addedFiles, removedFiles, changedFiles, addedKnots, removedKnots };
}

/** A markdown changelog between two releases (F1842). */
export function generateChangelog(diff: ReleaseDiff, fromName: string, toName: string): string {
  const lines = [`# Changes from ${fromName} to ${toName}`, ''];
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`## ${title}`);
    for (const i of items) lines.push(`- ${i}`);
    lines.push('');
  };
  section('New scenes', diff.addedFiles);
  section('Removed scenes', diff.removedFiles);
  section('Edited scenes', diff.changedFiles);
  section('New knots', diff.addedKnots);
  section('Removed knots', diff.removedKnots);
  if (
    diff.addedFiles.length +
      diff.removedFiles.length +
      diff.changedFiles.length +
      diff.addedKnots.length +
      diff.removedKnots.length ===
    0
  ) {
    lines.push('No changes.');
  }
  return lines.join('\n');
}

export interface SaveCompat {
  compatible: boolean;
  /** Knots removed in the new version — saves pointing here would break. */
  removedKnots: string[];
}

/**
 * Save-compatibility between two versions (F1843): a save is only safe to carry
 * forward if no knot it could be positioned at was removed.
 */
export function saveCompat(oldFiles: FileMap, newFiles: FileMap): SaveCompat {
  const removed = diffReleases(oldFiles, newFiles).removedKnots;
  return { compatible: removed.length === 0, removedKnots: removed };
}
