/**
 * HTML site importer (F1462).
 *
 * Walks a directory of .html/.htm files (recursively, skipping dotfiles),
 * converts each to a StagedDoc. Internal links between local HTML files become
 * framework link placeholders; local images become StagedAssets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedAsset, StagedDoc, StagedLink } from '../framework/index.js';

export interface HtmlSiteInput {
  path: string;
}

export class HtmlSiteAdapter implements SourceAdapter {
  readonly name = 'html';
  constructor(private readonly input: HtmlSiteInput) {}

  stage(): StagedDoc[] {
    const root = resolveDirPath(this.input.path);
    const htmlFiles = walkHtmlFiles(root);
    // Build a set of all known html relPaths (normalized, no extension) for link resolution.
    const knownIds = new Set(htmlFiles.map((f) => fileToSourceId(path.relative(root, f))));
    return htmlFiles.map((abs) => buildDoc(abs, root, knownIds));
  }
}

// ── Path validation ───────────────────────────────────────────────────────────

function resolveDirPath(inputPath: string): string {
  if (inputPath.includes('\0') || !path.isAbsolute(inputPath)) {
    throw validation('import path must be an absolute path with no NUL bytes');
  }
  let real: string;
  try {
    real = fs.realpathSync(inputPath);
  } catch {
    throw validation('import path does not exist', { path: inputPath });
  }
  if (!fs.statSync(real).isDirectory()) {
    throw validation('import path must be a directory', { path: inputPath });
  }
  return real;
}

// ── Directory walk ────────────────────────────────────────────────────────────

function walkHtmlFiles(root: string): string[] {
  const result: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        result.push(abs);
      }
    }
  };
  walk(root);
  return result;
}

// ── Source ID normalization ───────────────────────────────────────────────────

/** Convert a relative file path (possibly with .html/.htm) to a normalized source id. */
function fileToSourceId(relPath: string): string {
  // Normalize path separators to forward-slash, lowercase, strip extension.
  return relPath
    .split(path.sep)
    .join('/')
    .toLowerCase()
    .replace(/\.html?$/i, '');
}

// ── Per-file doc builder ──────────────────────────────────────────────────────

function buildDoc(abs: string, root: string, knownIds: Set<string>): StagedDoc {
  const relPath = path.relative(root, abs);
  const sourceId = fileToSourceId(relPath);
  const html = fs.readFileSync(abs, 'utf8');

  // Extract the notebook path from parent directories.
  const relDir = path.dirname(relPath);
  const notebookPath = relDir === '.' ? [] : relDir.split(path.sep).filter((s) => s !== '');

  const assets: StagedAsset[] = [];
  const links: StagedLink[] = [];

  const title = extractTitle(html, path.basename(relPath, path.extname(relPath)));
  const body = convertHtmlToMarkdown(html, abs, root, knownIds, assets, links);

  return {
    sourceId,
    title,
    body,
    notebookPath,
    tags: [],
    assets,
    links,
  };
}

// ── Title extraction ──────────────────────────────────────────────────────────

function extractTitle(html: string, fallback: string): string {
  // Try <title> first.
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch) {
    const t = decodeHtmlEntities(stripTags(titleMatch[1]!)).trim();
    if (t) return t;
  }
  // Try first <h1>.
  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1Match) {
    const t = decodeHtmlEntities(stripTags(h1Match[1]!)).trim();
    if (t) return t;
  }
  return fallback;
}

// ── HTML → Markdown conversion ────────────────────────────────────────────────

function convertHtmlToMarkdown(
  html: string,
  absPath: string,
  root: string,
  knownIds: Set<string>,
  assets: StagedAsset[],
  links: StagedLink[],
): string {
  let assetN = 0;

  // Strip <head>...</head> and HTML boilerplate.
  let md = html.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
  md = md.replace(/<\/?(?:html|body)[^>]*>/gi, '');

  // Headings.
  md = md.replace(
    /<h1[^>]*>([\s\S]*?)<\/h1>/gi,
    (_, inner: string) => `# ${decodeHtmlEntities(stripTags(inner)).trim()}\n\n`,
  );
  md = md.replace(
    /<h2[^>]*>([\s\S]*?)<\/h2>/gi,
    (_, inner: string) => `## ${decodeHtmlEntities(stripTags(inner)).trim()}\n\n`,
  );
  md = md.replace(
    /<h3[^>]*>([\s\S]*?)<\/h3>/gi,
    (_, inner: string) => `### ${decodeHtmlEntities(stripTags(inner)).trim()}\n\n`,
  );
  md = md.replace(
    /<h4[^>]*>([\s\S]*?)<\/h4>/gi,
    (_, inner: string) => `#### ${decodeHtmlEntities(stripTags(inner)).trim()}\n\n`,
  );

  // Blockquotes.
  md = md.replace(
    /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_, inner: string) =>
      decodeHtmlEntities(stripTags(inner))
        .trim()
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n') + '\n\n',
  );

  // Pre/code blocks — do before inline code so we don't double-wrap.
  md = md.replace(
    /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
    (_, inner: string) =>
      '```\n' + decodeHtmlEntities(inner.replace(/<[^>]+>/g, '')).trimEnd() + '\n```\n\n',
  );
  md = md.replace(
    /<code[^>]*>([\s\S]*?)<\/code>/gi,
    (_, inner: string) => '`' + decodeHtmlEntities(stripTags(inner)) + '`',
  );

  // Bold / italic.
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

  // Images — before links so we don't mis-process them.
  md = md.replace(
    /<img[^>]*?src="([^"]*)"[^>]*?(?:alt="([^"]*)")?[^>]*?\/?>/gi,
    (whole, src: string, alt: string = '') => {
      if (/^https?:\/\//i.test(src)) {
        // External image — keep as-is.
        return `![${alt}](${src})`;
      }
      // Local image.
      const imgAbs = resolveLocalPath(absPath, src);
      if (imgAbs && fs.existsSync(imgAbs)) {
        const ref = `img${assetN++}`;
        const filename = path.basename(imgAbs);
        const capturedPath = imgAbs;
        assets.push({ ref, filename, read: () => fs.readFileSync(capturedPath) });
        return `{{asset:${ref}}}`;
      }
      // Missing local image — keep original.
      return whole;
    },
  );

  // Links — after images.
  md = md.replace(
    /<a[^>]*?href="([^"]*)"[^>]*?>([\s\S]*?)<\/a>/gi,
    (whole, href: string, text: string) => {
      const linkText = decodeHtmlEntities(stripTags(text)).trim();
      // Check if it's an internal local .html link.
      if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href) || /^#/.test(href)) {
        return `[${linkText}](${href})`;
      }
      if (/\.html?$/i.test(href) || (!href.includes('.') && !href.startsWith('#'))) {
        const targetId = resolveHtmlLinkId(absPath, root, href);
        if (targetId !== null && knownIds.has(targetId)) {
          const link: StagedLink = { targetSourceId: targetId };
          if (linkText) link.label = linkText;
          links.push(link);
          return `{{link:${targetId}}}`;
        }
      }
      return `[${linkText}](${href})`;
    },
  );

  // List items.
  md = md.replace(
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    (_, inner: string) => `- ${decodeHtmlEntities(stripTags(inner)).trim()}\n`,
  );
  md = md.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');

  // Paragraphs and line breaks.
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, inner: string) => `${inner.trim()}\n\n`);
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags.
  md = md.replace(/<[^>]+>/g, '');

  // Decode remaining HTML entities.
  md = decodeHtmlEntities(md);

  // Normalize whitespace.
  md = md
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return md;
}

// ── Link resolution helpers ───────────────────────────────────────────────────

/** Resolve a local href relative to the current file into a sourceId. */
function resolveHtmlLinkId(fromAbs: string, root: string, href: string): string | null {
  // Strip fragment.
  const hrefNoFrag = href.split('#')[0]!;
  if (!hrefNoFrag) return null;
  try {
    const fromDir = path.dirname(fromAbs);
    const targetAbs = path.resolve(fromDir, hrefNoFrag);
    const targetRel = path.relative(root, targetAbs);
    return fileToSourceId(targetRel);
  } catch {
    return null;
  }
}

/** Resolve a local src path into an absolute path under root. */
function resolveLocalPath(fromAbs: string, src: string): string | null {
  if (!src || src.startsWith('data:')) return null;
  try {
    const fromDir = path.dirname(fromAbs);
    return path.resolve(fromDir, src);
  } catch {
    return null;
  }
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)));
}
