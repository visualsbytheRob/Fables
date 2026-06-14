/**
 * PDF-book export target (F1477).
 *
 * NOTE: This target produces PRINT-READY HTML, not a binary PDF file. Fables has
 * no server-side PDF renderer. To create a PDF, open `book.html` in any modern
 * browser and use File → Print → Save as PDF. The embedded stylesheet is tuned
 * for printing (A4/Letter, 2 cm margins, page-breaks at chapters).
 *
 * Output layout:
 *   book.html   — a single self-contained HTML "book":
 *                   • title page
 *                   • auto-generated table of contents (linked anchors)
 *                   • one chapter per notebook (page-break-before: always)
 *                   • one section per note within each chapter
 */

import { textFile, type ExportTarget, type ExportNote, type ExportFile } from '../index.js';

// ── Markdown → HTML converter (local copy; do not import from static-site) ───

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mdToHtml(md: string, noteTitleToId: Map<string, string>): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith('```')) {
      const fence: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        fence.push(escHtml(lines[i]!));
        i++;
      }
      i++;
      out.push(`<pre><code>${fence.join('\n')}</code></pre>`);
      continue;
    }

    const hm = /^(#{1,4})\s+(.+)$/.exec(line);
    if (hm) {
      const level = hm[1]!.length;
      out.push(`<h${level}>${inlineToHtml(hm[2]!, noteTitleToId)}</h${level}>`);
      i++;
      continue;
    }

    if (line.startsWith('> ')) {
      const qlines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('> ')) {
        qlines.push(inlineToHtml(lines[i]!.slice(2), noteTitleToId));
        i++;
      }
      out.push(`<blockquote>${qlines.join('<br>')}</blockquote>`);
      continue;
    }

    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('- ')) {
        items.push(`<li>${inlineToHtml(lines[i]!.slice(2), noteTitleToId)}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.startsWith('#') &&
      !lines[i]!.startsWith('> ') &&
      !lines[i]!.startsWith('- ') &&
      !lines[i]!.startsWith('```')
    ) {
      para.push(inlineToHtml(lines[i]!, noteTitleToId));
      i++;
    }
    if (para.length > 0) {
      out.push(`<p>${para.join('<br>')}</p>`);
    }
  }

  return out.join('\n');
}

function inlineToHtml(text: string, noteTitleToId: Map<string, string>): string {
  const codeSegments: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    const idx = codeSegments.length;
    codeSegments.push(`<code>${escHtml(code)}</code>`);
    return `\uE000CODE${idx}\uE000`;
  });

  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, t: string, u: string) => `<a href="${escHtml(u)}">${escHtml(t)}</a>`,
  );

  s = s.replace(/\[\[([^\]]+)\]\]/g, (_m, title: string) => {
    const id = noteTitleToId.get(title);
    if (id !== undefined) {
      return `<a href="#note-${escHtml(id)}">${escHtml(title)}</a>`;
    }
    return escHtml(title);
  });

  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t: string) => `<strong>${escHtml(t)}</strong>`);
  s = s.replace(/\*([^*]+)\*/g, (_m, t: string) => `<em>${escHtml(t)}</em>`);

  s = s.replace(/\uE000CODE(\d+)\uE000/g, (_m, idx: string) => codeSegments[Number(idx)] ?? '');

  s = s.replace(/(<[^>]+>)|([^<]+)/g, (_m, tag: string | undefined, text: string | undefined) => {
    if (tag !== undefined) return tag;
    if (text !== undefined) return text.replace(/&(?![a-zA-Z#\d]+;)/g, '&amp;');
    return '';
  });

  return s;
}

// ── Embedded stylesheet ───────────────────────────────────────────────────────

const STYLE = `
/* Fables PDF Book — print-ready HTML */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

@page {
  margin: 2cm;
}

body {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 11pt;
  color: #111;
  line-height: 1.6;
}

/* --- Title page --- */
.title-page {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 90vh;
  text-align: center;
  page-break-after: always;
}
.title-page h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
.title-page .subtitle { font-size: 1rem; color: #555; }

/* --- Table of contents --- */
.toc {
  page-break-after: always;
}
.toc h2 { font-size: 1.4rem; margin-bottom: 1rem; }
.toc ol { margin-left: 1.5rem; }
.toc li { margin: 0.25rem 0; }
.toc a { color: #111; text-decoration: none; }
.toc a:hover { text-decoration: underline; }
.toc .toc-note { margin-left: 1.5rem; font-size: 0.9em; color: #444; }

/* --- Chapter (notebook) --- */
.chapter {
  page-break-before: always;
}
.chapter > h1 {
  font-size: 2rem;
  margin-bottom: 2rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #111;
  break-after: avoid;
}

/* --- Note section --- */
.note-section {
  margin-bottom: 2.5rem;
}
.note-section h2 {
  font-size: 1.4rem;
  margin-bottom: 0.75rem;
  break-after: avoid;
}
h3 { font-size: 1.15rem; margin: 1rem 0 0.4rem; break-after: avoid; }
h4 { font-size: 1rem; margin: 0.85rem 0 0.3rem; break-after: avoid; }
p { margin: 0.6rem 0; }
ul { margin: 0.6rem 0 0.6rem 1.5rem; }
li { margin: 0.15rem 0; }
blockquote {
  border-left: 3px solid #ccc;
  padding-left: 0.75rem;
  color: #555;
  margin: 0.6rem 0;
}
pre {
  background: #f5f5f5;
  padding: 0.75rem;
  border-radius: 4px;
  font-size: 0.85em;
  overflow-x: auto;
  margin: 0.6rem 0;
}
code { background: #f5f5f5; padding: 0.1em 0.25em; border-radius: 2px; font-size: 0.875em; }
pre code { background: none; padding: 0; }
a { color: #1a56db; }
.note-meta { font-size: 0.8em; color: #777; margin-top: 0.5rem; }
.tags { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.4rem; }
.tag {
  background: #e8eaf6;
  color: #3730a3;
  padding: 0.1em 0.5em;
  border-radius: 9999px;
  font-size: 0.8em;
}

@media print {
  .chapter { page-break-before: always; }
  h1, h2, h3, h4 { break-after: avoid; }
  pre, blockquote { break-inside: avoid; }
}
`;

// ── Exporter ──────────────────────────────────────────────────────────────────

export class PdfBookExporter implements ExportTarget {
  readonly name = 'pdf-book';

  export(notes: ExportNote[]): ExportFile[] {
    // Build title → id map for wikilink → in-page anchors.
    const noteTitleToId = new Map<string, string>(notes.map((n) => [n.title, n.id]));

    // Group notes by notebook path.
    const chapterMap = new Map<string, { label: string; notes: ExportNote[] }>();
    for (const note of notes) {
      const key = note.notebookPath.join(' / ') || '(No notebook)';
      if (!chapterMap.has(key)) {
        chapterMap.set(key, { label: key, notes: [] });
      }
      chapterMap.get(key)!.notes.push(note);
    }
    const chapters = [...chapterMap.values()];

    const exportedAt = new Date().toLocaleString('en-US', {
      dateStyle: 'long',
      timeStyle: 'short',
    });

    // ── Title page ───────────────────────────────────────────────────────────
    const titlePage = `<div class="title-page">
  <h1>Fables Notes</h1>
  <p class="subtitle">Exported ${escHtml(exportedAt)} &mdash; ${notes.length} note${notes.length === 1 ? '' : 's'}</p>
</div>`;

    // ── Table of contents ────────────────────────────────────────────────────
    const tocItems = chapters
      .map((ch, ci) => {
        const chapterId = `chapter-${ci}`;
        const noteItems = ch.notes
          .map(
            (n) =>
              `      <li class="toc-note"><a href="#note-${escHtml(n.id)}">${escHtml(n.title)}</a></li>`,
          )
          .join('\n');
        return `    <li><a href="#${escHtml(chapterId)}">${escHtml(ch.label)}</a>
      <ol>
${noteItems}
      </ol>
    </li>`;
      })
      .join('\n');

    const toc = `<div class="toc">
  <h2>Table of Contents</h2>
  <ol>
${tocItems}
  </ol>
</div>`;

    // ── Chapters ─────────────────────────────────────────────────────────────
    const chaptersHtml = chapters
      .map((ch, ci) => {
        const chapterId = `chapter-${ci}`;
        const sectionsHtml = ch.notes
          .map((note) => {
            const bodyHtml = mdToHtml(note.body, noteTitleToId);
            const tagsHtml =
              note.tags.length > 0
                ? `<div class="tags">${note.tags.map((t) => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>`
                : '';
            return `  <section class="note-section" id="note-${escHtml(note.id)}">
    <h2>${escHtml(note.title)}</h2>
    <div class="note-meta">
      <span>Created: ${escHtml(note.createdAt)}</span> &bull;
      <span>Updated: ${escHtml(note.updatedAt)}</span>
    </div>
    ${tagsHtml}
    <div class="note-body">
${bodyHtml}
    </div>
  </section>`;
          })
          .join('\n');

        return `<div class="chapter" id="${escHtml(chapterId)}">
  <h1>${escHtml(ch.label)}</h1>
${sectionsHtml}
</div>`;
      })
      .join('\n\n');

    // ── Assemble the book ────────────────────────────────────────────────────
    const book = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fables Notes — Book</title>
  <style>${STYLE}</style>
</head>
<body>

${titlePage}

${toc}

${chaptersHtml}

</body>
</html>`;

    return [textFile('book.html', book)];
  }
}
