/**
 * ENML → markdown conversion (shared by the Apple Notes and Evernote importers).
 *
 * ENML is XHTML plus a few Evernote-specific tags. This converts to markdown and,
 * crucially, rewrites `<en-media hash="…"/>` references into the framework's
 * `{{asset:ref}}` placeholders, returning the asset refs it produced so the
 * importer can attach the matching resource bytes.
 *
 *   <en-todo checked="true"/>  → task-list checkbox (F1425)
 *   <en-media hash=… type=…/>  → asset placeholder (F1424 inline images/scans)
 *   <table>…</table>           → markdown table (F1426)
 */

import type { EnexResource } from './enex.js';
import { decodeXml } from './enex.js';

export interface EnmlAsset {
  ref: string;
  resource: EnexResource;
}

export interface EnmlResult {
  markdown: string;
  assets: EnmlAsset[];
}

/** Convert an ENML body to markdown, resolving media against the note's resources. */
export function enmlToMarkdown(enml: string, resources: EnexResource[]): EnmlResult {
  const byHash = new Map(resources.map((r) => [r.md5.toLowerCase(), r]));
  const assets: EnmlAsset[] = [];
  let html = enml;

  // Tables first (F1426) — convert before generic block handling strips structure.
  html = html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner: string) =>
    convertTable(inner),
  );

  // Checklists (F1425): map en-todo to a checkbox prefix on its line.
  html = html.replace(/<en-todo\s+checked="true"\s*\/?>/gi, 'XTODODONEX');
  html = html.replace(/<en-todo[^>]*\/?>/gi, 'XTODOOPENX');

  // Media (F1424): en-media → asset placeholder, matched by hash.
  let mediaN = 0;
  html = html.replace(/<en-media[^>]*\/?>/gi, (tag: string) => {
    const hash = /hash="([0-9a-f]+)"/i.exec(tag)?.[1]?.toLowerCase();
    const res = hash ? byHash.get(hash) : undefined;
    if (!res) return '';
    const ref = `e${mediaN++}`;
    assets.push({ ref, resource: res });
    return `{{asset:${ref}}}`;
  });

  let md = htmlToMarkdown(html);

  // Resolve the checkbox sentinels to task-list items at line starts.
  md = md
    .split('\n')
    .map((line) => {
      if (line.includes('XTODODONEX')) {
        return `- [x] ${line.replace(/XTODO(DONE|OPEN)X/g, '').trim()}`;
      }
      if (line.includes('XTODOOPENX')) {
        return `- [ ] ${line.replace(/XTODO(DONE|OPEN)X/g, '').trim()}`;
      }
      return line;
    })
    .join('\n');

  return { markdown: md.trim(), assets };
}

/** ENML XHTML → markdown (regex-based; ENML is well-formed and predictable). */
function htmlToMarkdown(html: string): string {
  let md = html;
  // Evernote wraps the body in <en-note>…</en-note>; drop the wrapper.
  md = md.replace(/<\/?en-note[^>]*>/gi, '');
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(
    /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_, inner: string) =>
      inner
        .trim()
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n') + '\n\n',
  );
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```\n\n');
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');
  md = md.replace(/<[^>]+>/g, ''); // strip remaining tags (keeps placeholders)
  md = decodeXml(md);
  md = md
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return md;
}

/** Convert an HTML table body to a markdown table (F1426). */
function convertTable(inner: string): string {
  const rows = [...inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      decodeXml(c[1]!.replace(/<[^>]+>/g, '').trim()).replace(/\|/g, '\\|'),
    ),
  );
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  const header = pad(rows[0]!);
  const sep = Array.from({ length: width }, () => '---');
  const body = rows.slice(1).map(pad);
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return `\n${[line(header), line(sep), ...body.map(line)].join('\n')}\n\n`;
}
