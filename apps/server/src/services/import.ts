import fs from 'node:fs';
import path from 'node:path';
import { validation, type NotebookId, type NoteId } from '@fables/core';
import { saveAttachmentFile } from '../attachments/store.js';
import type { Db } from '../db/connection.js';
import { attachmentsRepo } from '../db/repos/attachments.js';
import {
  importJobsRepo,
  type ImportFileError,
  type ImportJob,
  type ImportJobCounters,
} from '../db/repos/import-jobs.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { tagsRepo } from '../db/repos/tags.js';
import { parseFrontmatter, type FrontmatterValue } from '../lib/frontmatter.js';
import { sha256Hex } from '../lib/hash.js';
import { isValidTagName, normalizeTagName } from '../lib/hashtags.js';
import { buildTitlesIndex } from './links.js';
import { createNote, updateNote } from './notes.js';

/**
 * Markdown-folder / Obsidian-vault import (F291–F294, F297, F298).
 *
 * A vault is a directory of .md files: subfolders become nested notebooks,
 * YAML frontmatter maps to tags/timestamps/pinned, referenced local files
 * move into the content-addressed attachment store (links rewritten), and
 * [[wikilinks]] across the imported set resolve through the links service —
 * `createNote` runs the same `syncNoteLinks`/`onTitleChanged` pipeline as the
 * editor, so links written before their target exists heal automatically.
 * Obsidian vaults need no special casing beyond `![[embeds]]` and `.obsidian`
 * exclusion, both handled here (F292).
 */

export type CollisionMode = 'skip' | 'rename' | 'merge';

export interface ImportOptions {
  root: string;
  notebookId?: NotebookId;
  collisions: CollisionMode;
}

/** Directories never walked: vault config, VCS internals, hidden folders. */
const SKIPPED_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules']);

/** Validates a client-supplied server-local directory path (F294). */
export function validateImportDir(raw: string): string {
  if (raw.includes('\0')) throw validation('path contains a NUL byte');
  if (!path.isAbsolute(raw)) throw validation('path must be absolute', { path: raw });
  let real: string;
  try {
    real = fs.realpathSync(path.resolve(raw));
  } catch {
    throw validation('path does not exist', { path: raw });
  }
  if (!fs.statSync(real).isDirectory()) {
    throw validation('path is not a directory', { path: raw });
  }
  return real;
}

interface VaultFile {
  /** Path relative to the vault root, with `/` separators. */
  rel: string;
  abs: string;
}

/** All .md files under root, depth-first, stable order. */
export function walkMarkdownFiles(root: string): VaultFile[] {
  const out: VaultFile[] = [];
  const walk = (dir: string): void => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push({ rel: path.relative(root, abs).split(path.sep).join('/'), abs });
      }
    }
  };
  walk(root);
  return out;
}

/** Non-markdown files by basename — Obsidian resolves `![[img.png]]` vault-wide. */
function buildAssetIndex(root: string): Map<string, string> {
  const index = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && !entry.name.toLowerCase().endsWith('.md')) {
        if (!index.has(entry.name)) index.set(entry.name, abs);
      }
    }
  };
  walk(root);
  return index;
}

const MD_LINK_RE = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
const EMBED_RE = /!\[\[([^\][|\n]+?)(?:\|[^\]\n]*)?\]\]/g;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

interface AttachmentRef {
  /** Replacement span in the body. */
  start: number;
  end: number;
  /** Resolved absolute path of the local file. */
  abs: string;
  filename: string;
  /** Builds the replacement text once the attachment id is known. */
  replace: (url: string) => string;
}

function cleanTarget(raw: string): string {
  let target = raw.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  // Drop a markdown title suffix: (path "title")
  const titled = /^(\S+)\s+["'(]/.exec(target);
  if (titled) target = titled[1]!;
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** Resolves a relative target against the note's folder, kept inside the vault. */
function resolveLocal(target: string, fileDir: string, root: string): string | null {
  if (target === '' || target.startsWith('#') || path.isAbsolute(target)) return null;
  if (SCHEME_RE.test(target)) return null;
  const abs = path.resolve(fileDir, target);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null; // traversal guard
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  if (abs.toLowerCase().endsWith('.md')) return null; // note links stay wikilinks/md links
  return abs;
}

/** Local attachment references in a note body: md links/images + `![[embeds]]` (F292). */
export function findAttachmentRefs(
  body: string,
  fileDir: string,
  root: string,
  assetIndex: Map<string, string>,
): AttachmentRef[] {
  const refs: AttachmentRef[] = [];

  for (const match of body.matchAll(MD_LINK_RE)) {
    const target = cleanTarget(match[1]!);
    const abs = resolveLocal(target, fileDir, root);
    if (!abs) continue;
    const raw = match[0];
    const inner = match[1]!;
    const innerStart = match.index + raw.lastIndexOf(`(${inner})`) + 1;
    refs.push({
      start: innerStart,
      end: innerStart + inner.length,
      abs,
      filename: path.basename(abs),
      replace: (url) => url,
    });
  }

  for (const match of body.matchAll(EMBED_RE)) {
    const target = cleanTarget(match[1]!);
    if (!/\.[A-Za-z0-9]+$/.test(target) || target.toLowerCase().endsWith('.md')) continue;
    const abs =
      resolveLocal(target, fileDir, root) ??
      resolveLocal(target, root, root) ??
      assetIndex.get(path.basename(target)) ??
      null;
    if (!abs) continue;
    const filename = path.basename(abs);
    refs.push({
      start: match.index,
      end: match.index + match[0].length,
      abs,
      filename,
      replace: (url) => `![${filename}](${url})`,
    });
  }

  return refs.sort((a, b) => a.start - b.start);
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  txt: 'text/plain',
  csv: 'text/csv',
};

const mimeFor = (filename: string): string =>
  EXT_MIME[path.extname(filename).slice(1).toLowerCase()] ?? 'application/octet-stream';

const stripExtension = (rel: string): string => path.basename(rel).replace(/\.md$/i, '');

function titleFor(fm: Record<string, FrontmatterValue>, rel: string): string {
  const fromFm = typeof fm.title === 'string' ? fm.title.trim() : '';
  return fromFm !== '' ? fromFm : stripExtension(rel);
}

/** Frontmatter `tags:` in any common shape → normalized valid tag names. */
export function frontmatterTags(value: FrontmatterValue | undefined): string[] {
  if (value === undefined || typeof value === 'boolean') return [];
  const parts = Array.isArray(value) ? value : value.split(/[,\s]+/);
  const tags: string[] = [];
  for (const part of parts) {
    const name = normalizeTagName(part);
    if (name !== '' && isValidTagName(name) && !tags.includes(name)) tags.push(name);
  }
  return tags;
}

const isoOrNull = (value: FrontmatterValue | undefined): string | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// ---------------------------------------------------------------------------
// Dry-run scan (F294)
// ---------------------------------------------------------------------------

export interface ScanFileReport {
  path: string;
  title: string;
  attachments: number;
  /** True when a live note with this title (or an earlier scanned file) exists. */
  collision: boolean;
}

export interface ScanReport {
  path: string;
  files: ScanFileReport[];
  totals: { files: number; attachments: number; collisions: number };
}

export function scanImport(db: Db, root: string): ScanReport {
  const assetIndex = buildAssetIndex(root);
  const existingTitles = new Set(buildTitlesIndex(db).keys());
  const files: ScanFileReport[] = [];
  let attachments = 0;
  let collisions = 0;
  for (const file of walkMarkdownFiles(root)) {
    const { data, body } = parseFrontmatter(fs.readFileSync(file.abs, 'utf8'));
    const title = titleFor(data, file.rel);
    const refs = findAttachmentRefs(body, path.dirname(file.abs), root, assetIndex);
    const collision = existingTitles.has(title.toLowerCase());
    existingTitles.add(title.toLowerCase());
    if (collision) collisions += 1;
    attachments += refs.length;
    files.push({ path: file.rel, title, attachments: refs.length, collision });
  }
  return { path: root, files, totals: { files: files.length, attachments, collisions } };
}

// ---------------------------------------------------------------------------
// Import run (F291–F293, F297, F298)
// ---------------------------------------------------------------------------

interface ImportContext {
  db: Db;
  dataDir: string;
  root: string;
  collisions: CollisionMode;
  assetIndex: Map<string, string>;
  /** Lowercased live titles → note id, updated as the run creates notes. */
  titles: Map<string, NoteId>;
  /** Relative dir → notebook id. '' is the import root notebook. */
  notebooks: Map<string, NotebookId>;
  counters: ImportJobCounters;
  errors: ImportFileError[];
}

function notebookForDir(ctx: ImportContext, relDir: string): NotebookId {
  const key = relDir === '.' ? '' : relDir;
  const cached = ctx.notebooks.get(key);
  if (cached !== undefined) return cached;
  const parent = notebookForDir(ctx, path.dirname(key) === '.' ? '' : path.dirname(key));
  const created = notebooksRepo(ctx.db).create({ name: path.basename(key), parentId: parent });
  ctx.notebooks.set(key, created.id);
  return created.id;
}

/** Rename strategy: "Title (imported)", then "(imported 2)", … (F298). */
function renamedTitle(ctx: ImportContext, title: string): string {
  let candidate = `${title} (imported)`;
  for (let n = 2; ctx.titles.has(candidate.toLowerCase()); n += 1) {
    candidate = `${title} (imported ${n})`;
  }
  return candidate;
}

function importAttachments(
  ctx: ImportContext,
  body: string,
  fileDir: string,
): { body: string; attachmentIds: string[] } {
  const refs = findAttachmentRefs(body, fileDir, ctx.root, ctx.assetIndex);
  const attachmentIds: string[] = [];
  let out = body;
  for (const ref of [...refs].reverse()) {
    const content = fs.readFileSync(ref.abs);
    const hash = sha256Hex(content);
    saveAttachmentFile(ctx.dataDir, hash, content);
    const attachment = attachmentsRepo(ctx.db).create({
      noteId: null, // claimed by the note right after creation
      filename: ref.filename,
      mime: mimeFor(ref.filename),
      size: content.byteLength,
      hash,
    });
    attachmentIds.push(attachment.id);
    const replacement = ref.replace(`/api/v1/attachments/${attachment.id}`);
    out = out.slice(0, ref.start) + replacement + out.slice(ref.end);
  }
  ctx.counters.attachments += attachmentIds.length;
  return { body: out, attachmentIds };
}

function importOneFile(ctx: ImportContext, file: VaultFile): void {
  const { db } = ctx;
  const { data, body: rawBody } = parseFrontmatter(fs.readFileSync(file.abs, 'utf8'));
  let title = titleFor(data, file.rel);
  const notebookId = notebookForDir(ctx, path.dirname(file.rel));

  const existingId = ctx.titles.get(title.toLowerCase());
  if (existingId !== undefined && ctx.collisions === 'skip') {
    ctx.counters.skipped += 1;
    return;
  }

  const { body, attachmentIds } = importAttachments(ctx, rawBody, path.dirname(file.abs));

  let noteId: NoteId;
  if (existingId !== undefined && ctx.collisions === 'merge') {
    // Merge = the imported file becomes the existing note's new content.
    const existing = notesRepo(db).get(existingId)!;
    updateNote(db, existingId, existing.rev, { body });
    noteId = existingId;
    ctx.counters.merged += 1;
  } else {
    if (existingId !== undefined) {
      title = renamedTitle(ctx, title);
      ctx.counters.renamed += 1;
    }
    const note = createNote(db, { notebookId, title, body });
    noteId = note.id;
    ctx.titles.set(title.toLowerCase(), noteId);
    ctx.counters.imported += 1;
  }

  if (attachmentIds.length > 0) {
    const claim = db.prepare('UPDATE attachments SET note_id = ? WHERE id = ?');
    for (const id of attachmentIds) claim.run(noteId, id);
  }

  const tags = tagsRepo(db);
  for (const name of frontmatterTags(data.tags)) {
    tags.linkNote(noteId, tags.ensure(name).id, false);
  }

  // Metadata that bypasses the editing pipeline: preserved timestamps + pinned.
  const created = isoOrNull(data.created);
  const updated = isoOrNull(data.updated);
  const pinned = data.pinned === true || data.pinned === 'true' ? 1 : null;
  if (created !== null || updated !== null || pinned !== null) {
    db.prepare(
      `UPDATE notes SET created_at = COALESCE(?, created_at),
         updated_at = COALESCE(?, updated_at), pinned = COALESCE(?, pinned)
       WHERE id = ?`,
    ).run(created, updated, pinned, noteId);
  }
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Files per progress update; the loop yields between batches so polls get served. */
export const IMPORT_BATCH_SIZE = 20;

/**
 * Runs a prepared import job to completion, updating its progress row between
 * batches (F297). Per-file failures are recorded and never abort the run.
 */
export async function runImportJob(
  db: Db,
  dataDir: string,
  jobId: string,
  opts: ImportOptions,
): Promise<ImportJob> {
  const jobs = importJobsRepo(db);
  const files = walkMarkdownFiles(opts.root);
  const ctx: ImportContext = {
    db,
    dataDir,
    root: opts.root,
    collisions: opts.collisions,
    assetIndex: buildAssetIndex(opts.root),
    titles: buildTitlesIndex(db),
    notebooks: new Map(),
    counters: { processed: 0, imported: 0, merged: 0, renamed: 0, skipped: 0, attachments: 0 },
    errors: [],
  };

  try {
    // Root notebook: the given one, or a new notebook named after the folder.
    if (opts.notebookId !== undefined) {
      if (!notebooksRepo(db).get(opts.notebookId)) {
        throw validation('notebookId does not exist', { notebookId: opts.notebookId });
      }
      ctx.notebooks.set('', opts.notebookId);
    } else {
      const name = path.basename(opts.root) || 'Imported';
      ctx.notebooks.set('', notebooksRepo(db).create({ name }).id);
    }

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]!;
      try {
        importOneFile(ctx, file);
      } catch (error) {
        ctx.errors.push({ file: file.rel, message: (error as Error).message });
      }
      ctx.counters.processed += 1;
      if ((i + 1) % IMPORT_BATCH_SIZE === 0) {
        jobs.progress(jobId, ctx.counters, ctx.errors);
        await yieldToEventLoop();
      }
    }
    jobs.progress(jobId, ctx.counters, ctx.errors);
    jobs.finish(jobId, 'done');
  } catch (error) {
    ctx.errors.push({ file: '(run)', message: (error as Error).message });
    jobs.progress(jobId, ctx.counters, ctx.errors);
    jobs.finish(jobId, 'failed');
  }
  return jobs.get(jobId)!;
}

/** Creates the job row and returns it; callers kick off `runImportJob`. */
export function startImportJob(db: Db, opts: ImportOptions): ImportJob {
  return importJobsRepo(db).create(opts.root, walkMarkdownFiles(opts.root).length);
}
