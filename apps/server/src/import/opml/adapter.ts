/**
 * OPML importer (F1464).
 *
 * Accepts an `.opml` or `.xml` file and maps each top-level <outline> under
 * <body> to one StagedDoc, with nested outlines rendered as a markdown bullet list.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedDoc } from '../framework/index.js';

export interface OpmlInput {
  path: string;
}

export class OpmlAdapter implements SourceAdapter {
  readonly name = 'opml';
  constructor(private readonly input: OpmlInput) {}

  stage(): StagedDoc[] {
    const real = resolvePath(this.input.path, ['.opml', '.xml']);
    const xml = fs.readFileSync(real, 'utf8');
    return parseOpml(xml);
  }
}

// ── path validation ────────────────────────────────────────────────────────

function resolvePath(inputPath: string, exts: string[]): string {
  if (inputPath.includes('\0') || !path.isAbsolute(inputPath)) {
    throw validation('import path must be an absolute path with no NUL bytes');
  }
  let real: string;
  try {
    real = fs.realpathSync(inputPath);
  } catch {
    throw validation('import path does not exist', { path: inputPath });
  }
  const lower = real.toLowerCase();
  if (!exts.some((e) => lower.endsWith(e))) {
    throw validation(`expected an ${exts.join(' or ')} file`);
  }
  return real;
}

// ── XML entity decoder ─────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

// ── OPML attribute extractor ───────────────────────────────────────────────

function attr(tag: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*?)"|'([^']*?)')`, 'i');
  const m = re.exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : '';
}

// ── Recursive outline parser ───────────────────────────────────────────────

interface Outline {
  text: string;
  xmlUrl: string;
  htmlUrl: string;
  type: string;
  children: Outline[];
}

/**
 * Parse the XML into a flat token stream and build a tree.
 * Handles self-closing `<outline ... />` and nested `<outline ...>...</outline>`.
 */
function parseOutlines(xml: string): Outline[] {
  // Strip everything before <body> and after </body>
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(xml);
  if (!bodyMatch) return [];
  const body = bodyMatch[1] ?? '';

  const stack: Outline[][] = [[]];

  const tokenRe = /<(\/outline)|(<outline\b[^>]*?)(\/?)>/gi;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(body)) !== null) {
    const isClose = Boolean(m[1]);
    const openTag = m[2];
    const selfClose = m[3] === '/';

    if (isClose) {
      // </outline>
      if (stack.length > 1) {
        const children = stack.pop()!;
        const parent = stack[stack.length - 1]!;
        const parentOutline = parent[parent.length - 1];
        if (parentOutline) parentOutline.children = children;
      }
    } else if (openTag !== undefined) {
      const tag = openTag + '>';
      const outline: Outline = {
        text: decodeEntities(attr(tag, 'text') || attr(tag, 'title')),
        xmlUrl: attr(tag, 'xmlUrl'),
        htmlUrl: attr(tag, 'htmlUrl'),
        type: attr(tag, 'type'),
        children: [],
      };
      const current = stack[stack.length - 1]!;
      current.push(outline);
      if (!selfClose) {
        // open tag — push a new children array
        stack.push([]);
      }
    }
  }

  return stack[0] ?? [];
}

// ── Outline → markdown bullet list ────────────────────────────────────────

function outlineToMarkdown(outline: Outline, depth: number): string {
  const indent = '  '.repeat(depth);
  let line: string;
  if (outline.xmlUrl) {
    line = `${indent}- [${outline.text || outline.xmlUrl}](${outline.xmlUrl})`;
  } else {
    line = `${indent}- ${outline.text}`;
  }
  const childLines = outline.children.map((c) => outlineToMarkdown(c, depth + 1));
  return [line, ...childLines].join('\n');
}

// ── Top-level parser ───────────────────────────────────────────────────────

function parseOpml(xml: string): StagedDoc[] {
  const topLevel = parseOutlines(xml);
  return topLevel.map((outline, i) => {
    const title = outline.text || `Outline ${i + 1}`;
    const sourceId = title.toLowerCase();
    const bodyLines = outline.children.map((c) => outlineToMarkdown(c, 0));
    const body = bodyLines.join('\n');
    const doc: StagedDoc = {
      sourceId,
      title,
      body,
      notebookPath: [],
      tags: [],
      assets: [],
      links: [],
    };
    return doc;
  });
}
