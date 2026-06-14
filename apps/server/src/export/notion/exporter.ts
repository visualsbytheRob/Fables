/**
 * Notion-importable export target (F1473).
 *
 * Produces a markdown + CSV bundle that Notion can re-import:
 *   - One .md per note under its notebook folders with a `# <title>` heading
 *   - A top-level index.csv (Notion-database-style) with Name, Notebook, Tags, Created
 */

import {
  textFile,
  safeName,
  type ExportTarget,
  type ExportNote,
  type ExportFile,
} from '../index.js';

export class NotionExporter implements ExportTarget {
  readonly name = 'notion-md';

  export(notes: ExportNote[]): ExportFile[] {
    const files: ExportFile[] = [];
    const csvRows: string[] = ['Name,Notebook,Tags,Created'];

    for (const note of notes) {
      // Build .md file.
      const pathSegments = [...note.notebookPath.map(safeName), `${safeName(note.title)}.md`];
      const notePath = pathSegments.join('/');
      const content = `# ${note.title}\n\n${note.body}`;
      files.push(textFile(notePath, content));

      // Build CSV row.
      const notebookStr = note.notebookPath.join(' / ');
      const tagsStr = note.tags.join(', ');
      csvRows.push([note.title, notebookStr, tagsStr, note.createdAt].map(csvEscape).join(','));
    }

    files.push(textFile('index.csv', csvRows.join('\n') + '\n'));
    return files;
  }
}

/**
 * CSV-escape a single value: wrap in double quotes if it contains commas, quotes,
 * or newlines; double any inner quotes per RFC 4180.
 */
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
