/**
 * Roam Research importer (F1441, F1443-F1448).
 *
 * Roam exports a single JSON file: an array of pages, each a tree of blocks
 * (`{ string, uid, children }`). This adapter parses that into the shared
 * outliner model, which handles block refs, page links, daily notes, namespaces,
 * and queries.
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

export interface RoamInput {
  /** Server-local path to the Roam `.json` export. */
  path: string;
  namespaces?: 'nest' | 'flat';
}

interface RoamBlock {
  string?: string;
  title?: string;
  uid?: string;
  children?: RoamBlock[];
}

export class RoamAdapter implements SourceAdapter {
  readonly name = 'roam';
  constructor(private readonly input: RoamInput) {}

  stage(): StagedDoc[] {
    const raw = readJson(this.input.path);
    const pages = raw.map(toPage).filter((p): p is OutlinerPage => p !== null);
    return outlinerToStaged(pages, {
      ...DEFAULT_OUTLINER_OPTIONS,
      source: this.name,
      namespaces: this.input.namespaces ?? DEFAULT_OUTLINER_OPTIONS.namespaces,
    });
  }
}

function toPage(node: RoamBlock): OutlinerPage | null {
  const title = (node.title ?? '').trim();
  if (title === '') return null;
  return { title, blocks: (node.children ?? []).map(toBlock) };
}

function toBlock(node: RoamBlock): OutlinerBlock {
  const block: OutlinerBlock = {
    text: node.string ?? '',
    children: (node.children ?? []).map(toBlock),
  };
  if (node.uid) block.uid = node.uid;
  return block;
}

function readJson(inputPath: string): RoamBlock[] {
  if (inputPath.includes('\0') || !path.isAbsolute(inputPath)) {
    throw validation('import path must be an absolute path with no NUL bytes');
  }
  let real: string;
  try {
    real = fs.realpathSync(inputPath);
  } catch {
    throw validation('import path does not exist', { path: inputPath });
  }
  if (!fs.statSync(real).isFile() || !real.toLowerCase().endsWith('.json')) {
    throw validation('expected a Roam .json export file');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(real, 'utf8'));
  } catch {
    throw validation('Roam export is not valid JSON');
  }
  if (!Array.isArray(parsed)) throw validation('Roam export must be a JSON array of pages');
  return parsed as RoamBlock[];
}
