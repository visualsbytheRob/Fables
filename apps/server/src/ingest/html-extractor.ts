/**
 * HTML/URL content extractor (F765, F771–F779).
 *
 * Takes raw HTML (or fetches a URL) and uses @mozilla/readability + linkedom
 * to extract article content, then converts to Markdown.
 *
 * Features:
 *   - Readability extracts the main article content, discarding nav/ads (F765)
 *   - Preserves images as attachment-worthy data URLs where feasible (F775)
 *   - Extracts clip metadata: source URL, site name, clipped-at, favicon (F776)
 *   - Raw-text fallback when Readability fails (F779) — paywalled/JS-only pages
 */

import { AppError } from '@fables/core';

export const HTML_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ClipMetadata {
  sourceUrl: string;
  siteName: string | null;
  title: string;
  byline: string | null;
  clippedAt: string;
  favicon: string | null;
  excerpt: string | null;
}

export interface HtmlExtractionResult {
  title: string;
  markdownBody: string;
  metadata: ClipMetadata;
  /** Images found in the article (src URLs) — caller may download as attachments (F775). */
  imageUrls: string[];
  /** True when Readability parsed a real article; false = raw-text fallback (F779). */
  readabilitySucceeded: boolean;
}

/** Minimal HTML-to-Markdown converter — handles common inline formatting. */
function htmlToMarkdown(html: string): string {
  let md = html;
  // Block elements — order matters (specific before generic)
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n');
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) =>
    inner.trim().split('\n').map((l: string) => `> ${l}`).join('\n') + '\n\n',
  );
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n\n');
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```\n\n');
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  // Inline elements
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  md = md.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');
  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, '');
  // Decode entities
  md = md
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'");
  // Normalize whitespace
  md = md.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return md;
}

/** Extract image src URLs from HTML string. */
function extractImageUrls(html: string): string[] {
  const urls: string[] = [];
  const re = /<img[^>]*src="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1]!;
    // Skip data: URIs (already inline), only keep http/https URLs
    if (src.startsWith('http://') || src.startsWith('https://')) {
      urls.push(src);
    }
  }
  return [...new Set(urls)].slice(0, 20); // cap at 20 images
}

/**
 * Extract article content from raw HTML.
 * Uses @mozilla/readability + linkedom for server-side DOM.
 */
export async function extractHtml(
  html: string,
  sourceUrl: string,
  selection?: string,
): Promise<HtmlExtractionResult> {
  if (Buffer.byteLength(html, 'utf8') > HTML_MAX_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', `HTML exceeds the ${HTML_MAX_BYTES / 1024 / 1024} MB limit`);
  }

  const clippedAt = new Date().toISOString();

  // Try Readability extraction
  let title = '';
  let articleHtml = '';
  let siteName: string | null = null;
  let byline: string | null = null;
  let excerpt: string | null = null;
  let readabilitySucceeded = false;

  try {
    const { parseHTML } = await import('linkedom');
    const readabilityMod = await import('@mozilla/readability');
    const Readability = readabilityMod.Readability as unknown as new (
      doc: Record<string, unknown>,
    ) => { parse(): null | {
      title: string | null | undefined;
      content: string | null | undefined;
      excerpt: string | null | undefined;
      byline: string | null | undefined;
      siteName: string | null | undefined;
    } };

    const { document } = parseHTML(html) as { document: Record<string, unknown> };
    const reader = new Readability(document);
    const article = reader.parse();

    if (article && article.content && article.content.length > 100) {
      title = article.title || '';
      articleHtml = article.content;
      siteName = article.siteName ?? null;
      byline = article.byline ?? null;
      excerpt = article.excerpt ?? null;
      readabilitySucceeded = true;
    }
  } catch {
    // Readability/linkedom failure → raw fallback
  }

  if (!readabilitySucceeded) {
    // Raw-text fallback (F779): strip all tags
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    title = titleMatch ? titleMatch[1]!.trim() : new URL(sourceUrl).hostname;
    articleHtml = html;
  }

  // If a user selection was passed, use it as a quote block instead (F774)
  let markdownBody: string;
  if (selection && selection.trim().length > 0) {
    const quotedSelection = selection
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    markdownBody = `${quotedSelection}\n\n[Source: ${sourceUrl}]`;
  } else {
    markdownBody = htmlToMarkdown(articleHtml);
  }

  const imageUrls = extractImageUrls(articleHtml);

  // Extract favicon URL (F776)
  const faviconMatch = /<link[^>]*rel="(?:shortcut )?icon"[^>]*href="([^"]+)"/i.exec(html);
  let favicon: string | null = null;
  if (faviconMatch) {
    favicon = faviconMatch[1]!;
    // Resolve relative favicon URLs
    if (favicon.startsWith('/')) {
      try {
        const base = new URL(sourceUrl);
        favicon = `${base.origin}${favicon}`;
      } catch {
        favicon = null;
      }
    }
  }

  // Extract site name from og:site_name if not from Readability
  if (!siteName) {
    const ogSiteMatch = /<meta[^>]*property="og:site_name"[^>]*content="([^"]+)"/i.exec(html);
    if (ogSiteMatch) siteName = ogSiteMatch[1]!;
    else {
      try {
        siteName = new URL(sourceUrl).hostname;
      } catch {
        siteName = null;
      }
    }
  }

  const metadata: ClipMetadata = {
    sourceUrl,
    siteName,
    title,
    byline,
    clippedAt,
    favicon,
    excerpt,
  };

  return { title, markdownBody, metadata, imageUrls, readabilitySucceeded };
}

/**
 * Fetch a URL and extract its content (F765, F771).
 * Handles timeouts and basic failure modes.
 */
export async function fetchAndExtract(
  url: string,
  selection?: string,
): Promise<HtmlExtractionResult> {
  let html: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Fables/1.0 (web-clipper; +https://github.com/fables-app)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      if (!resp.ok) {
        // Paywall / JS-only page fallback (F779): use empty content
        html = `<html><head><title>${url}</title></head><body><p>Page returned HTTP ${resp.status}. Content may require authentication or JavaScript.</p></body></html>`;
      } else {
        html = await resp.text();
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const msg = String(err);
    if (msg.includes('abort') || msg.includes('timeout')) {
      throw new AppError('BAD_REQUEST', `Fetch timed out for URL: ${url}`);
    }
    throw new AppError('BAD_REQUEST', `Failed to fetch URL: ${msg}`, { details: { url } });
  }
  return extractHtml(html, url, selection);
}
