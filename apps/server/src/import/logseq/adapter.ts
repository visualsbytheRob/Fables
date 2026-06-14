/**
 * Logseq importer (F1442-F1448).
 *
 * Logseq is a directory of markdown (or org) outliner files: `pages/*.md` and
 * `journals/*.md`. Each file is a bullet outliner; block ids live in `id::`
 * properties. This adapter parses the indentation into the shared outliner block
 * tree, then the shared model handles refs/links/daily-notes/namespaces/queries.
 *
 * `.md` is fully supported; `.org` files are parsed best-effort (bullets and
 * headings) and flagged, since org's full syntax isn't reproduced.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedDoc } from '../framework/index.js';
import {
  DEFAULT_OUTLINER_OPTIONS,
  outlinerToStaged,
  type OutlinerBlock,
  type OutlinerPage,
} from '../outliner/model.js';

export interface LogseqInput {
  /** Server-local path to the Logseq graph directory. */
  path: string;
  namespaces?: 'nest' | 'flat';
}

export class LogseqAdapter implements SourceAdapter {
  readonly name = 'logseq';
  constructor(private readonly input: LogseqInput) {}

  stage(): StagedDoc[] {
    const dir = resolveDir(this.input.path);
    const pages: OutlinerPage[] = [];
    for (const sub of ['pages', 'journals']) {
      const subdir = path.join(dir, sub);
      if (!fs.existsSync(subdir)) continue;
      for (const name of fs.readdirSync(subdir).sort()) {
        if (!/\.(md|org)$/i.test(name)) continue;
        const content = fs.readFileSync(path.join(subdir, name), 'utf8');
        pages.push({
          title: filenameToTitle(name),
          blocks: parseOutliner(content),
        });
      }
    }
    return outlinerToStaged(pages, {
      ...DEFAULT_OUTLINER_OPTIONS,
      source: this.name,
      namespaces: this.input.namespaces ?? DEFAULT_OUTLINER_OPTIONS.namespaces,
    });
  }
}

/** Logseq encodes namespace `/` and other chars in filenames. */
export function filenameToTitle(filename: string): string {
  const base = filename.replace(/\.(md|org)$/i, '');
  return decodeURIComponentSafe(base.replace(/___/g, '/').replace(/%2F/gi, '/'));
}

/** Parse a Logseq outliner file into a block tree, extracting `id::` properties. */
export function parseOutliner(content: string): OutlinerBlock[] {
  const root: OutlinerBlock = { text: '', children: [] };
  const stack: { depth: number; block: OutlinerBlock }[] = [{ depth: -1, block: root }];

  for (const rawLine of content.split('\n')) {
    // Normalize tabs to two-space indentation units.
    const line = rawLine.replace(/\t/g, '  ');
    const m = /^(\s*)-\s?(.*)$/.exec(line);
    if (!m) {
      // Continuation of the current block (multi-line content / properties).
      const top = stack[stack.length - 1]!.block;
      if (top !== root && line.trim() !== '') top.text += `\n${line.trim()}`;
      continue;
    }
    const depth = Math.floor(m[1]!.length / 2);
    const block: OutlinerBlock = { text: m[2]!, children: [] };
    while (stack.length > 1 && stack[stack.length - 1]!.depth >= depth) stack.pop();
    stack[stack.length - 1]!.block.children.push(block);
    stack.push({ depth, block });
  }

  for (const b of allBlocks(root.children)) extractId(b);
  return root.children;
}

/** Pull a Logseq `id:: uid` property out of a block's text into its uid. */
function extractId(block: OutlinerBlock): void {
  const lines = block.text.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const m = /^\s*id::\s*(\S+)\s*$/.exec(line);
    if (m) block.uid = m[1]!;
    else kept.push(line);
  }
  block.text = kept.join('\n').trim();
}

function allBlocks(blocks: OutlinerBlock[]): OutlinerBlock[] {
  const out: OutlinerBlock[] = [];
  const walk = (bs: OutlinerBlock[]): void => {
    for (const b of bs) {
      out.push(b);
      walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

function resolveDir(inputPath: string): string {
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
    throw validation('Logseq import path must be the graph directory');
  }
  return real;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
