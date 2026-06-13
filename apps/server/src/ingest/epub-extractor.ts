/**
 * EPUB text extractor (F764).
 *
 * Uses fflate to unzip the EPUB (which is a ZIP), then:
 *   1. Parses the OPF (Open Packaging Format) to find the reading-order spine.
 *   2. Reads each spine item (XHTML), strips tags to get plain text.
 *   3. Each chapter becomes a section in the output, separated by headings.
 *
 * Size guardrail (F769): rejects EPUBs > MAX_EPUB_BYTES.
 */

import { AppError } from '@fables/core';
import { unzipSync } from 'fflate';

export const EPUB_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
export const EPUB_MAX_CHAPTERS = 200;

export interface EpubChapter {
  order: number;
  title: string;
  text: string;
}

export interface EpubExtractionResult {
  chapters: EpubChapter[];
  bookTitle: string;
  author: string;
}

/** Minimal XML/HTML tag stripper — good enough for EPUB body text. */
function stripTags(html: string): string {
  // Remove script and style blocks
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Replace block elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'");
  // Collapse excessive whitespace
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/** Extract text between two XML tags — simplistic but avoids a full XML parser dep. */
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(xml);
  return m ? m[1]!.trim() : '';
}

/** Get all attribute values matching a pattern in an XML string. */
function extractAttrs(xml: string, tagPattern: RegExp, attr: string): string[] {
  const attrRe = new RegExp(`${attr}="([^"]*)"`, 'i');
  const results: string[] = [];
  let match;
  while ((match = tagPattern.exec(xml)) !== null) {
    const tagStr = match[0];
    const attrMatch = attrRe.exec(tagStr);
    if (attrMatch) results.push(attrMatch[1]!);
  }
  return results;
}

export function extractEpub(buffer: Buffer, filename: string): EpubExtractionResult {
  if (buffer.byteLength > EPUB_MAX_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', `EPUB exceeds the ${EPUB_MAX_BYTES / 1024 / 1024} MB limit`, {
      details: { limitBytes: EPUB_MAX_BYTES, actualBytes: buffer.byteLength },
    });
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch (err) {
    throw new AppError('VALIDATION', 'invalid EPUB — could not unzip', {
      details: { cause: String(err) },
    });
  }

  // Find the OPF container file (META-INF/container.xml → OPF path)
  const containerXmlBytes = files['META-INF/container.xml'];
  if (!containerXmlBytes) {
    throw new AppError('VALIDATION', 'invalid EPUB — missing META-INF/container.xml');
  }
  const containerXml = new TextDecoder().decode(containerXmlBytes);
  const rootfileMatch = /rootfile[^>]*full-path="([^"]+)"/i.exec(containerXml);
  if (!rootfileMatch) {
    throw new AppError('VALIDATION', 'invalid EPUB — cannot find OPF path in container.xml');
  }
  const opfPath = rootfileMatch[1]!;
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const opfBytes = files[opfPath];
  if (!opfBytes) {
    throw new AppError('VALIDATION', `invalid EPUB — OPF file not found: ${opfPath}`);
  }
  const opfXml = new TextDecoder().decode(opfBytes);

  // Extract metadata
  const bookTitle = extractTag(opfXml, 'dc:title') || filename.replace(/\.epub$/i, '');
  const author = extractTag(opfXml, 'dc:creator') || '';

  // Parse manifest: id → href map
  const manifestMap = new Map<string, string>();
  const itemRe = /<item\s[^>]+>/gi;
  let itemMatch;
  while ((itemMatch = itemRe.exec(opfXml)) !== null) {
    const itemTag = itemMatch[0];
    const idMatch = /\bid="([^"]+)"/.exec(itemTag);
    const hrefMatch = /href="([^"]+)"/.exec(itemTag);
    if (idMatch && hrefMatch) {
      manifestMap.set(idMatch[1]!, hrefMatch[1]!);
    }
  }

  // Parse spine: ordered list of idref attributes
  const spineSection = /<spine[\s\S]*?<\/spine>/i.exec(opfXml)?.[0] ?? '';
  const spineIdrefs = extractAttrs(spineSection, /<itemref\s[^>]+>/gi, 'idref');

  if (spineIdrefs.length === 0) {
    throw new AppError('VALIDATION', 'invalid EPUB — spine is empty');
  }

  const chapters: EpubChapter[] = [];
  const limit = Math.min(spineIdrefs.length, EPUB_MAX_CHAPTERS);

  for (let i = 0; i < limit; i++) {
    const idref = spineIdrefs[i]!;
    const href = manifestMap.get(idref);
    if (!href) continue;

    const fullPath = opfDir + href;
    // Try with and without fragment (#anchor)
    const pathWithoutFragment = fullPath.split('#')[0]!;
    const chapterBytes = files[pathWithoutFragment] ?? files[fullPath];
    if (!chapterBytes) continue;

    const html = new TextDecoder().decode(chapterBytes);
    // Try to extract a title from h1/h2 tags
    const titleMatch = /<h[12][^>]*>([^<]+)<\/h[12]>/i.exec(html);
    const chapterTitle = titleMatch ? stripTags(titleMatch[1]!) : `Chapter ${i + 1}`;
    const text = stripTags(html);
    if (text.length > 0) {
      chapters.push({ order: i + 1, title: chapterTitle, text });
    }
  }

  return { chapters, bookTitle, author };
}

/**
 * Convert extracted EPUB chapters to a chaptered note body (F764).
 * Uses Markdown headings to separate chapters.
 */
export function epubChaptersToBody(result: EpubExtractionResult): string {
  const lines: string[] = [];
  if (result.author) {
    lines.push(`*by ${result.author}*\n`);
  }
  for (const chapter of result.chapters) {
    lines.push(`## ${chapter.title}`);
    lines.push(chapter.text);
    lines.push('');
  }
  return lines.join('\n');
}
