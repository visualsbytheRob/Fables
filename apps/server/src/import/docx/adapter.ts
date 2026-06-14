/**
 * DOCX importer (F1461).
 *
 * A `.docx` is a ZIP archive. The document body lives in `word/document.xml`
 * as WordprocessingML. We extract headings, bold/italic runs, list paragraphs,
 * and plain text, converting them to markdown.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedDoc } from '../framework/index.js';
import { readZip } from '../lib/zip.js';

export interface DocxInput {
  path: string;
}

export class DocxAdapter implements SourceAdapter {
  readonly name = 'docx';
  constructor(private readonly input: DocxInput) {}

  stage(): StagedDoc[] {
    const filePath = resolveDocxPath(this.input.path);
    const buf = fs.readFileSync(filePath);
    const entries = readZip(buf);

    const docEntry = entries.find((e) => e.name === 'word/document.xml');
    if (!docEntry) {
      throw validation('DOCX file is missing word/document.xml', { path: filePath });
    }

    const xml = docEntry.data.toString('utf8');
    const hasMedia = entries.some((e) => !e.isDirectory && e.name.startsWith('word/media/'));

    const { title, body } = parseDocumentXml(xml, path.basename(filePath, '.docx'));

    const doc: StagedDoc = {
      sourceId: path.basename(filePath, '.docx').toLowerCase().replace(/\s+/g, '-'),
      title,
      body,
      notebookPath: [],
      tags: [],
      assets: [],
      links: [],
    };

    if (hasMedia) {
      doc.metadata = { lossy: ['embedded images not imported'] };
    }

    return [doc];
  }
}

// ── Path validation ───────────────────────────────────────────────────────────

function resolveDocxPath(inputPath: string): string {
  if (inputPath.includes('\0') || !path.isAbsolute(inputPath)) {
    throw validation('import path must be an absolute path with no NUL bytes');
  }
  let real: string;
  try {
    real = fs.realpathSync(inputPath);
  } catch {
    throw validation('import path does not exist', { path: inputPath });
  }
  const stat = fs.statSync(real);
  if (!stat.isFile() || !real.toLowerCase().endsWith('.docx')) {
    throw validation('import path must be a .docx file', { path: inputPath });
  }
  return real;
}

// ── WordprocessingML → Markdown ──────────────────────────────────────────────

function parseDocumentXml(xml: string, fallbackTitle: string): { title: string; body: string } {
  // Extract all <w:p>...</w:p> paragraphs.
  const paragraphs = extractParagraphs(xml);
  const lines: string[] = [];
  let firstHeading: string | undefined;

  for (const para of paragraphs) {
    const line = convertParagraph(para);
    if (line === null) continue;
    if (firstHeading === undefined && line.startsWith('#')) {
      // Extract the text content of the heading (strip leading hashes and space).
      firstHeading = line.replace(/^#+\s*/, '').trim();
    }
    lines.push(line);
  }

  const title = firstHeading ?? fallbackTitle;
  const body = lines
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, body };
}

/** Pull out the raw XML of each <w:p> element. */
function extractParagraphs(xml: string): string[] {
  const result: string[] = [];
  const re = /<w:p[ >][^]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    result.push(m[0]!);
  }
  return result;
}

/** Convert a single WordprocessingML paragraph to a markdown line. */
function convertParagraph(para: string): string | null {
  const headingLevel = detectHeadingLevel(para);
  const isList = /<w:numPr>/i.test(para);

  const runs = extractRuns(para);
  const text = runs.trim();

  if (!text) return null;

  if (headingLevel > 0) {
    const prefix = '#'.repeat(headingLevel);
    return `${prefix} ${text}`;
  }

  if (isList) {
    return `- ${text}`;
  }

  return text;
}

/** Detect heading level from paragraph style. Returns 0 for non-headings. */
function detectHeadingLevel(para: string): number {
  // Match <w:pStyle w:val="Heading1"/> etc.
  const m = /<w:pStyle[^>]*w:val="([^"]+)"/i.exec(para);
  if (!m) return 0;
  const val = m[1]!;
  if (/^title$/i.test(val)) return 1;
  const hm = /^heading\s*(\d)/i.exec(val);
  if (hm) return Math.min(parseInt(hm[1]!, 10), 6);
  return 0;
}

/** Extract all text runs from a paragraph, applying bold/italic formatting. */
function extractRuns(para: string): string {
  const parts: string[] = [];
  // Match each <w:r>...</w:r> run.
  const runRe = /<w:r[ >][^]*?<\/w:r>/g;
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(para)) !== null) {
    const run = m[0]!;
    const isBold =
      /<w:b\/>|<w:b>|<w:b\s/i.test(run) &&
      !/<w:bCs/i.test(run.replace(/<w:b\/>|<w:b>|<w:bCs[^>]*>/gi, ''));
    const isItalic =
      /<w:i\/>|<w:i>|<w:i\s/i.test(run) &&
      !/<w:iCs/i.test(run.replace(/<w:i\/>|<w:i>|<w:iCs[^>]*>/gi, ''));
    const textRe = /<w:t[^>]*>([^<]*)<\/w:t>/gi;
    let tm: RegExpExecArray | null;
    let runText = '';
    while ((tm = textRe.exec(run)) !== null) {
      runText += decodeXmlEntities(tm[1]!);
    }
    if (!runText) continue;
    if (isBold && isItalic) {
      parts.push(`***${runText}***`);
    } else if (isBold) {
      parts.push(`**${runText}**`);
    } else if (isItalic) {
      parts.push(`*${runText}*`);
    } else {
      parts.push(runText);
    }
  }
  return parts.join('');
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
