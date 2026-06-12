/**
 * Note export + copy (F195/F196): download a note as a `.md` file, copy the
 * raw markdown, or copy rendered HTML (markdown → sanitized HTML via the
 * same react-markdown pipeline, rendered to a static string).
 */
import { exportFilename } from './text.js';

export interface ExportableNote {
  title: string;
  body: string;
}

/** Full markdown document for a note: H1 title (when set) + body. */
export function noteToMarkdown(note: ExportableNote): string {
  const title = note.title.trim();
  if (title === '' || note.body.trimStart().startsWith(`# ${title}`)) return note.body;
  return `# ${title}\n\n${note.body}`;
}

/** Triggers a browser download of the note as markdown (F195). */
export function downloadMarkdown(
  note: ExportableNote,
  doc: Document = document,
): { filename: string } {
  const filename = exportFilename(note.title);
  const blob = new Blob([noteToMarkdown(note)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { filename };
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/**
 * Renders the note to sanitized HTML (lazy import keeps react-dom/server and
 * the markdown pipeline off the main chunk).
 */
export async function noteToHtml(note: ExportableNote): Promise<string> {
  const [{ renderToStaticMarkup }, { createElement }, { MarkdownPreview }] = await Promise.all([
    import('react-dom/server'),
    import('react'),
    import('../preview/MarkdownPreview.js'),
  ]);
  return renderToStaticMarkup(createElement(MarkdownPreview, { source: noteToMarkdown(note) }));
}

export async function copyAsHtml(note: ExportableNote): Promise<void> {
  await copyText(await noteToHtml(note));
}
