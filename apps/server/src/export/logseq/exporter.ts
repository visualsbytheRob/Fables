/**
 * Logseq export target (F1474).
 *
 * Produces a Logseq graph:
 *   - Date-titled notes (YYYY-MM-DD or YYYY_MM_DD) → journals/<YYYY_MM_DD>.md
 *   - All other notes → pages/<safeName(title)>.md
 *   - Body converted to Logseq outliner form (top-level lines become `- ` bullets)
 *   - Tags appended as `tags:: a, b` property if present
 *   - [[wikilinks]] left as-is
 */

import {
  textFile,
  safeName,
  type ExportTarget,
  type ExportNote,
  type ExportFile,
} from '../index.js';

const DATE_RE = /^(\d{4})[-_](\d{2})[-_](\d{2})$/;

export class LogseqExporter implements ExportTarget {
  readonly name = 'logseq';

  export(notes: ExportNote[]): ExportFile[] {
    return notes.map((note) => {
      const dateMatch = DATE_RE.exec(note.title.trim());
      let notePath: string;
      if (dateMatch) {
        // journals/<YYYY_MM_DD>.md
        notePath = `journals/${dateMatch[1]!}_${dateMatch[2]!}_${dateMatch[3]!}.md`;
      } else {
        notePath = `pages/${safeName(note.title)}.md`;
      }

      const outlineBody = toLogseqOutline(note.body);
      const tagsLine = note.tags.length > 0 ? `\ntags:: ${note.tags.join(', ')}\n` : '';

      return textFile(notePath, `${outlineBody}${tagsLine}`);
    });
  }
}

/**
 * Convert a markdown body to Logseq outliner format:
 * - Empty lines are preserved as-is (or collapsed between bullets).
 * - Lines already starting with `- ` are left untouched.
 * - All other non-empty lines become `- <line>` top-level bullets.
 */
function toLogseqOutline(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    if (line.trim() === '') {
      // Preserve blank lines between bullets.
      out.push('');
    } else if (line.startsWith('- ')) {
      // Already a bullet — leave as-is.
      out.push(line);
    } else {
      // Convert to a bullet.
      out.push(`- ${line}`);
    }
  }

  // Trim trailing blanks, add a trailing newline.
  while (out.length > 0 && out[out.length - 1]!.trim() === '') {
    out.pop();
  }

  return out.join('\n') + (out.length > 0 ? '\n' : '');
}
