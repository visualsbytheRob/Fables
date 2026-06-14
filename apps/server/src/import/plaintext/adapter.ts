/**
 * Plain text importer (F1467).
 *
 * Accepts a single `.txt` file or a directory of `.txt` files (recursive).
 * Each file is heuristically upgraded to markdown and becomes one StagedDoc.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedDoc } from '../framework/index.js';

export interface PlaintextInput {
  path: string;
}

export class PlaintextAdapter implements SourceAdapter {
  readonly name = 'plaintext';
  constructor(private readonly input: PlaintextInput) {}

  stage(): StagedDoc[] {
    const real = resolvePath(this.input.path);
    const stat = fs.statSync(real);
    if (stat.isDirectory()) {
      return collectTxtFiles(real).map((f) => fileToDoc(f, real));
    }
    return [fileToDoc(real, path.dirname(real))];
  }
}

// ── path validation ────────────────────────────────────────────────────────

function resolvePath(inputPath: string): string {
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
  if (stat.isDirectory()) return real;
  if (!real.toLowerCase().endsWith('.txt')) {
    throw validation('expected a .txt file or a directory of .txt files');
  }
  return real;
}

// ── recursive file collector ───────────────────────────────────────────────

function collectTxtFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTxtFiles(full));
    } else if (entry.name.toLowerCase().endsWith('.txt')) {
      results.push(full);
    }
  }
  return results.sort();
}

// ── heuristic plain-text → markdown upgrader ──────────────────────────────

const LIST_RE = /^([-*•]|\d+[.)]) /;
const ORDERED_RE = /^(\d+[.)]) /;

function upgradeToMarkdown(text: string): { markdown: string; title: string } {
  const rawLines = text.split(/\r?\n/);
  const out: string[] = [];
  let title = '';

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i] ?? '';
    const next = rawLines[i + 1];

    // Setext heading: line followed by ===... or ---...
    if (next !== undefined && /^={3,}$/.test(next.trim()) && line.trim().length > 0) {
      const heading = `# ${line.trim()}`;
      if (!title) title = line.trim();
      out.push(heading);
      i += 1; // skip the underline
      continue;
    }
    if (next !== undefined && /^-{3,}$/.test(next.trim()) && line.trim().length > 0) {
      const heading = `## ${line.trim()}`;
      if (!title) title = line.trim();
      out.push(heading);
      i += 1;
      continue;
    }

    // ALL CAPS heading: more than 3 letters, entirely uppercase (allows spaces/punctuation)
    const letters = line.replace(/[^a-zA-Z]/g, '');
    if (
      letters.length > 3 &&
      letters === letters.toUpperCase() &&
      line.trim().length > 0 &&
      !LIST_RE.test(line)
    ) {
      const heading = `# ${line.trim()}`;
      if (!title) title = line.trim();
      out.push(heading);
      continue;
    }

    // List items
    if (LIST_RE.test(line)) {
      if (ORDERED_RE.test(line)) {
        // Keep ordered list as-is
        out.push(line);
      } else {
        // Normalize bullet to '- '
        out.push(line.replace(/^[*•]\s+/, '- ').replace(/^-\s+/, '- '));
      }
      continue;
    }

    out.push(line);
  }

  return { markdown: out.join('\n'), title };
}

// ── file → StagedDoc ──────────────────────────────────────────────────────

function fileToDoc(filePath: string, root: string): StagedDoc {
  const text = fs.readFileSync(filePath, 'utf8');
  const { markdown, title: headingTitle } = upgradeToMarkdown(text);

  // Title: first heading, else first non-empty line (≤120 chars), else filename
  let title = headingTitle ? headingTitle.slice(0, 120) : '';
  if (!title) {
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().length > 0) {
        title = line.trim().slice(0, 120);
        break;
      }
    }
  }
  if (!title) title = path.basename(filePath, '.txt');

  // notebookPath = parent folders relative to root
  const rel = path.relative(root, filePath);
  const parts = rel.split(path.sep);
  const notebookPath = parts.slice(0, -1); // all but filename

  // sourceId = relative path lowercased
  const sourceId = rel.toLowerCase();

  const doc: StagedDoc = {
    sourceId,
    title,
    body: markdown,
    notebookPath,
    tags: [],
    assets: [],
    links: [],
  };
  return doc;
}
