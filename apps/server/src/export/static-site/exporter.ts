/**
 * Static-site export target (F1476).
 *
 * Produces a self-contained, read-only HTML vault — open `index.html` in any
 * browser to browse your notes. No server or JavaScript required.
 *
 * Output layout:
 *   index.html       — note listing grouped by notebook, linking to each note
 *   <id>.html        — one page per note (title, body, tags, timestamps)
 *   style.css        — shared stylesheet (system font, readable column, light theme)
 */

import { textFile, type ExportTarget, type ExportNote, type ExportFile } from '../index.js';

// ── Markdown → HTML converter ─────────────────────────────────────────────────

/** HTML-escape text so it is safe to embed in attribute values or element content. */
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert Fables markdown to HTML.
 *
 * Supported constructs:
 *   # … ####     headings
 *   **bold**     strong
 *   *italic*     em
 *   `code`       inline code
 *   ```fences``` code blocks
 *   - item       unordered list items
 *   > quote      blockquote lines
 *   [text](url)  links
 *   [[wikilink]] internal link if title matches; plain text otherwise
 *   paragraphs   blank-line separated
 */
function mdToHtml(md: string, noteTitleToId: Map<string, string>): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    if (line.startsWith('```')) {
      const fence: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        fence.push(escHtml(lines[i]!));
        i++;
      }
      i++; // consume closing ```
      out.push(`<pre><code>${fence.join('\n')}</code></pre>`);
      continue;
    }

    // Headings
    const hm = /^(#{1,4})\s+(.+)$/.exec(line);
    if (hm) {
      const level = hm[1]!.length;
      out.push(`<h${level}>${inlineToHtml(hm[2]!, noteTitleToId)}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote — collect consecutive > lines
    if (line.startsWith('> ')) {
      const qlines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('> ')) {
        qlines.push(inlineToHtml(lines[i]!.slice(2), noteTitleToId));
        i++;
      }
      out.push(`<blockquote>${qlines.join('<br>')}</blockquote>`);
      continue;
    }

    // Unordered list — collect consecutive - lines
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('- ')) {
        items.push(`<li>${inlineToHtml(lines[i]!.slice(2), noteTitleToId)}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — collect until blank line or block element
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

/** Convert inline markdown within a single line to HTML. */
function inlineToHtml(text: string, noteTitleToId: Map<string, string>): string {
  // Process in passes — most specific first to avoid partial matches.

  // Inline code (protect from further substitution by using a placeholder approach)
  const codeSegments: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    const idx = codeSegments.length;
    codeSegments.push(`<code>${escHtml(code)}</code>`);
    return `\uE000CODE${idx}\uE000`;
  });

  // Links [text](url)
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, t: string, u: string) => `<a href="${escHtml(u)}">${escHtml(t)}</a>`,
  );

  // Wikilinks [[title]]
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_m, title: string) => {
    const id = noteTitleToId.get(title);
    if (id !== undefined) {
      return `<a href="${escHtml(id)}.html">${escHtml(title)}</a>`;
    }
    return escHtml(title);
  });

  // Bold **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t: string) => `<strong>${escHtml(t)}</strong>`);

  // Italic *text*
  s = s.replace(/\*([^*]+)\*/g, (_m, t: string) => `<em>${escHtml(t)}</em>`);

  // Restore code segments
  s = s.replace(/\uE000CODE(\d+)\uE000/g, (_m, idx: string) => codeSegments[Number(idx)] ?? '');

  // Escape remaining plain text (anything not already in a tag)
  // We only escape outside of HTML tags.
  s = escapeTextOutsideTags(s);

  return s;
}

/**
 * Escape ampersands and angle brackets that are NOT already part of an HTML tag
 * or entity (i.e., text nodes only).
 */
function escapeTextOutsideTags(s: string): string {
  // Split on tags, escape the text runs, rejoin.
  return s.replace(
    /(<[^>]+>)|([^<]+)/g,
    (_m, tag: string | undefined, text: string | undefined) => {
      if (tag !== undefined) return tag;
      if (text !== undefined) return text.replace(/&(?![a-zA-Z#\d]+;)/g, '&amp;');
      return '';
    },
  );
}

// ── Stylesheet ────────────────────────────────────────────────────────────────

const CSS = `/* Fables static export */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #fafafa;
  color: #1a1a1a;
  line-height: 1.65;
  padding: 2rem 1rem;
}
.container { max-width: 720px; margin: 0 auto; }
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
h1 { font-size: 2rem; margin-bottom: 0.5rem; }
h2 { font-size: 1.4rem; margin: 1.5rem 0 0.5rem; }
h3 { font-size: 1.15rem; margin: 1.25rem 0 0.4rem; }
h4 { font-size: 1rem; margin: 1rem 0 0.3rem; }
p { margin: 0.75rem 0; }
ul { margin: 0.75rem 0 0.75rem 1.5rem; }
li { margin: 0.2rem 0; }
blockquote {
  border-left: 3px solid #d1d5db;
  padding-left: 1rem;
  color: #6b7280;
  margin: 0.75rem 0;
}
pre {
  background: #f3f4f6;
  padding: 1rem;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 0.875rem;
  margin: 0.75rem 0;
}
code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
pre code { background: none; padding: 0; }
.notebook-group { margin: 2rem 0; }
.notebook-name { font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.08em; color: #6b7280; margin-bottom: 0.5rem; }
.note-list { list-style: none; }
.note-list li { padding: 0.25rem 0; }
.tags { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 1rem 0; }
.tag {
  background: #e0e7ff;
  color: #3730a3;
  padding: 0.15em 0.6em;
  border-radius: 9999px;
  font-size: 0.8rem;
}
.meta { font-size: 0.8rem; color: #6b7280; margin-top: 2rem; padding-top: 1rem;
  border-top: 1px solid #e5e7eb; }
.back { display: inline-block; margin-bottom: 1.5rem; font-size: 0.875rem; color: #6b7280; }
.back:hover { color: #2563eb; }
`;

// ── Exporter ──────────────────────────────────────────────────────────────────

export class StaticSiteExporter implements ExportTarget {
  readonly name = 'static-site';

  export(notes: ExportNote[]): ExportFile[] {
    const files: ExportFile[] = [];

    // Build title → id map for wikilink resolution.
    const noteTitleToId = new Map<string, string>(notes.map((n) => [n.title, n.id]));

    // ── style.css ────────────────────────────────────────────────────────────
    files.push(textFile('style.css', CSS));

    // ── Per-note pages ───────────────────────────────────────────────────────
    for (const note of notes) {
      const bodyHtml = mdToHtml(note.body, noteTitleToId);
      const tagsHtml =
        note.tags.length > 0
          ? `<div class="tags">${note.tags.map((t) => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>`
          : '';

      const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(note.title)}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <a class="back" href="index.html">← All notes</a>
    <h1>${escHtml(note.title)}</h1>
    ${tagsHtml}
    <div class="note-body">
${bodyHtml}
    </div>
    <div class="meta">
      <div>Created: ${escHtml(note.createdAt)}</div>
      <div>Updated: ${escHtml(note.updatedAt)}</div>
      ${note.notebookPath.length > 0 ? `<div>Notebook: ${escHtml(note.notebookPath.join(' › '))}</div>` : ''}
    </div>
  </div>
</body>
</html>`;
      files.push(textFile(`${note.id}.html`, page));
    }

    // ── index.html — notes grouped by notebook ───────────────────────────────
    // Group notes by their notebookPath (joined as a string key).
    const groups = new Map<string, { label: string; notes: ExportNote[] }>();
    for (const note of notes) {
      const key = note.notebookPath.join(' / ') || '(No notebook)';
      if (!groups.has(key)) {
        groups.set(key, { label: key, notes: [] });
      }
      groups.get(key)!.notes.push(note);
    }

    const groupsHtml = [...groups.values()]
      .map(
        (g) => `    <div class="notebook-group">
      <div class="notebook-name">${escHtml(g.label)}</div>
      <ul class="note-list">
        ${g.notes
          .map((n) => `<li><a href="${escHtml(n.id)}.html">${escHtml(n.title)}</a></li>`)
          .join('\n        ')}
      </ul>
    </div>`,
      )
      .join('\n');

    const index = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fables Export</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1>Fables Export</h1>
    <p>${notes.length} note${notes.length === 1 ? '' : 's'}</p>
${groupsHtml}
  </div>
</body>
</html>`;

    files.push(textFile('index.html', index));

    return files;
  }
}
