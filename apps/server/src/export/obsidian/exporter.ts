/**
 * Obsidian export target (F1472).
 *
 * Produces an Obsidian-flavoured vault:
 *   - One markdown file per note at <notebookPath>/<safeName(title)>.md
 *   - YAML frontmatter with tags, created, updated
 *   - Attachments written to vault-root attachments/ folder (deduped)
 *   - Body attachment refs rewritten from /api/v1/attachments/<id> → attachments/<filename>
 *   - [[wikilinks]] left untouched (Obsidian-native)
 */

import {
  textFile,
  safeName,
  type ExportTarget,
  type ExportNote,
  type ExportFile,
} from '../index.js';

export class ObsidianExporter implements ExportTarget {
  readonly name = 'obsidian';

  export(notes: ExportNote[]): ExportFile[] {
    const files: ExportFile[] = [];
    // Track used attachment names to deduplicate across the vault.
    const usedNames = new Map<string, string>(); // filename → attachment id that claimed it

    // First pass: collect all attachment filenames to detect collisions.
    const attNameCount = new Map<string, number>();
    for (const note of notes) {
      for (const att of note.attachments) {
        const base = safeName(att.filename);
        attNameCount.set(base, (attNameCount.get(base) ?? 0) + 1);
      }
    }

    // Second pass: build note files and attachment files.
    const emittedAttachments = new Map<string, string>(); // att.id → vault-relative path

    for (const note of notes) {
      // Resolve attachment names for this note's attachments.
      for (const att of note.attachments) {
        if (emittedAttachments.has(att.id)) continue;
        const base = safeName(att.filename);
        let chosenName: string;
        if (!usedNames.has(base)) {
          chosenName = base;
          usedNames.set(base, att.id);
        } else if (usedNames.get(base) === att.id) {
          // Same id already registered (shouldn't happen but be safe).
          chosenName = base;
        } else {
          // Collision: prefix with a short id slice.
          chosenName = `${att.id.slice(0, 8)}-${base}`;
        }
        const vaultPath = `attachments/${chosenName}`;
        emittedAttachments.set(att.id, vaultPath);
        files.push({ path: vaultPath, data: att.read() });
      }

      // Build YAML frontmatter.
      const tagLines =
        note.tags.length > 0
          ? `tags:\n${note.tags.map((t) => `  - ${yamlString(t)}`).join('\n')}\n`
          : 'tags: []\n';
      const frontmatter = `---\n${tagLines}created: ${note.createdAt}\nupdated: ${note.updatedAt}\n---\n\n`;

      // Rewrite /api/v1/attachments/<id> refs in the body.
      let body = note.body;
      for (const att of note.attachments) {
        const vaultPath = emittedAttachments.get(att.id);
        if (!vaultPath) continue;
        const apiRef = `/api/v1/attachments/${att.id}`;
        body = body.split(apiRef).join(vaultPath);
      }

      // Build note file path: <notebook segments>/<safeName(title)>.md
      const pathSegments = [...note.notebookPath.map(safeName), `${safeName(note.title)}.md`];
      const notePath = pathSegments.join('/');

      files.push(textFile(notePath, `${frontmatter}${body}`));
    }

    return files;
  }
}

/** Minimal YAML string escaping: wrap in quotes if value contains special chars. */
function yamlString(s: string): string {
  if (/[:#[\]{},&*?|<>=!%@`"']/.test(s) || s.includes('\n')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}
