/**
 * Evernote importer (F1431–F1438).
 *
 * Reuses the shared ENEX/ENML core. Evernote exports one `.enex` per notebook;
 * point this at a single `.enex` or a directory of them.
 *
 *   F1431  notes, resources, attributes        F1435  web-clip handling (source url)
 *   F1432  ENML → markdown (shared)             F1436  resource extraction with hashes
 *   F1433  notebook mapping (file → notebook)   F1437  reminder/todo attribute mapping
 *   F1434  flat tag import                      F1438  large-file streaming parse
 *
 * Honest limits: Evernote tag *hierarchies* and notebook *stacks* aren't present
 * in ENEX, so tags import flat and stacks can't be reconstructed (noted as lossy).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedAsset, StagedDoc } from '../framework/index.js';
import { streamEnexNotes, type EnexNote } from '../lib/enex.js';
import { enmlToMarkdown } from '../lib/enml.js';

export interface EvernoteInput {
  /** Server-local path to a `.enex` file or a directory of them. */
  path: string;
  /** Web clips: 'simplify' (default, markdown) keeps prose; 'preserve' notes the raw source. */
  webClip?: 'simplify' | 'preserve';
}

export class EvernoteAdapter implements SourceAdapter {
  readonly name = 'evernote';
  readonly skippedLocked: string[] = [];

  constructor(private readonly input: EvernoteInput) {}

  stage(): StagedDoc[] {
    this.skippedLocked.length = 0;
    const files = resolveEnexFiles(this.input.path);
    const docs: StagedDoc[] = [];
    for (const file of files) {
      const notebook = path.basename(file).replace(/\.enex$/i, '');
      let index = 0;
      for (const note of streamEnexNotes(file)) {
        if (note.encrypted) {
          this.skippedLocked.push(note.title);
          index += 1;
          continue;
        }
        docs.push(this.toDoc(notebook, note, index));
        index += 1;
      }
    }
    return docs;
  }

  private toDoc(notebook: string, note: EnexNote, index: number): StagedDoc {
    const { markdown, assets } = enmlToMarkdown(note.content, note.resources);
    const stagedAssets: StagedAsset[] = assets.map((a) => ({
      ref: a.ref,
      filename: a.resource.filename,
      mime: a.resource.mime,
      read: () => a.resource.data,
    }));

    const lossy = new Set<string>();
    const extras: string[] = [];

    // Web clip (F1435): surface the source, flag what the clip drops.
    const sourceUrl = note.attributes['source-url'];
    if (sourceUrl) {
      extras.push(`> Clipped from [${sourceUrl}](${sourceUrl})`);
      lossy.add(
        this.input.webClip === 'preserve'
          ? 'web clip simplified to markdown (original styling not preserved)'
          : 'web clip simplified to markdown',
      );
    }

    // Reminders (F1437): render reminder attributes as a visible line.
    const reminder = note.attributes['reminder-time'];
    if (reminder) {
      const done = note.attributes['reminder-done-time'] ? ' (done)' : '';
      extras.push(`> ⏰ Reminder: ${reminder}${done}`);
    }

    const body = extras.length > 0 ? `${extras.join('\n')}\n\n${markdown}` : markdown;
    const sourceId = crypto
      .createHash('md5')
      .update(`evernote ${notebook} ${note.title} ${note.created ?? index}`)
      .digest('hex');

    const doc: StagedDoc = {
      sourceId,
      title: note.title,
      body,
      notebookPath: notebook ? [notebook] : [],
      tags: note.tags, // F1434: flat (ENEX has no tag hierarchy)
      assets: stagedAssets,
      links: [],
    };
    if (note.created !== undefined) doc.createdAt = note.created;
    if (note.updated !== undefined) doc.updatedAt = note.updated;
    if (lossy.size > 0) doc.metadata = { lossy: [...lossy] };
    return doc;
  }
}

function resolveEnexFiles(inputPath: string): string[] {
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
  if (stat.isFile()) {
    if (!real.toLowerCase().endsWith('.enex')) throw validation('expected a .enex file');
    return [real];
  }
  if (stat.isDirectory()) {
    return fs
      .readdirSync(real)
      .filter((n) => n.toLowerCase().endsWith('.enex'))
      .sort()
      .map((n) => path.join(real, n));
  }
  throw validation('import path must be a .enex file or a directory of them');
}
