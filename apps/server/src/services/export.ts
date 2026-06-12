import fs from 'node:fs';
import path from 'node:path';
import { validation, type AttachmentId, type NoteId } from '@fables/core';
import { attachmentPath } from '../attachments/store.js';
import type { Db } from '../db/connection.js';
import { attachmentsRepo } from '../db/repos/attachments.js';
import { notesRepo } from '../db/repos/notes.js';
import { tagsRepo } from '../db/repos/tags.js';
import { formatFrontmatter } from '../lib/frontmatter.js';

/**
 * Full vault export (F295): notebooks become nested folders of .md files with
 * frontmatter (title, tags, created, updated, pinned); attachments land in an
 * `attachments/` folder with body links rewritten to relative paths; wikilinks
 * are left untouched — they address notes by title, which survives the trip.
 * No zip dependency exists, so the export writes to a server-side directory
 * and returns a manifest.
 */

export interface ExportManifest {
  notes: number;
  attachments: number;
  path: string;
}

export function validateExportDir(raw: string, dataDir: string): string {
  if (raw.includes('\0')) throw validation('path contains a NUL byte');
  if (!path.isAbsolute(raw)) throw validation('path must be absolute', { path: raw });
  const dest = path.resolve(raw);
  const data = path.resolve(dataDir);
  if (dest === data || dest.startsWith(data + path.sep)) {
    throw validation('refusing to export into the Fables data directory', { path: raw });
  }
  if (fs.existsSync(dest) && !fs.statSync(dest).isDirectory()) {
    throw validation('path exists and is not a directory', { path: raw });
  }
  return dest;
}

/** Filesystem-safe single path segment. */
const sanitize = (name: string): string => {
  const safe = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  return safe === '' ? 'untitled' : safe;
};

/** `name`, `name (2)`, `name (3)`… against a per-folder used set. */
function dedupe(used: Set<string>, name: string): string {
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${name} (${n})`;
  used.add(candidate.toLowerCase());
  return candidate;
}

interface NotebookRow {
  id: string;
  parent_id: string | null;
  name: string;
}

/** Notebook id → folder path relative to the export root ('' for orphans). */
function notebookFolders(db: Db): Map<string, string> {
  const rows = db.prepare('SELECT id, parent_id, name FROM notebooks').all() as NotebookRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const folders = new Map<string, string>();
  const usedByParent = new Map<string, Set<string>>();

  const folderOf = (id: string, seen: Set<string>): string => {
    const cached = folders.get(id);
    if (cached !== undefined) return cached;
    const row = byId.get(id);
    if (!row || seen.has(id)) return '';
    seen.add(id);
    const parent = row.parent_id === null ? '' : folderOf(row.parent_id, seen);
    let used = usedByParent.get(parent);
    if (!used) {
      used = new Set(['attachments']); // root-level name reserved for blobs
      usedByParent.set(parent, used);
    }
    const name = dedupe(used, sanitize(row.name));
    const folder = parent === '' ? name : `${parent}/${name}`;
    folders.set(id, folder);
    return folder;
  };

  for (const row of rows) folderOf(row.id, new Set());
  return folders;
}

const ATTACHMENT_URL_RE = /\/api\/v1\/attachments\/(att_[0-9A-HJKMNP-TV-Z]{26})/g;

const encodePath = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

export function exportVault(db: Db, dataDir: string, dest: string): ExportManifest {
  fs.mkdirSync(dest, { recursive: true });
  const folders = notebookFolders(db);
  const attachments = attachmentsRepo(db);
  const tags = tagsRepo(db);

  // hash → exported filename under attachments/ (content-addressed dedupe).
  const exportedByHash = new Map<string, string>();
  const usedAttachmentNames = new Set<string>();
  const usedNoteNames = new Map<string, Set<string>>();

  const exportAttachment = (id: AttachmentId): string | null => {
    const attachment = attachments.get(id);
    if (!attachment) return null;
    const existing = exportedByHash.get(attachment.hash);
    if (existing !== undefined) return existing;
    const source = attachmentPath(dataDir, attachment.hash);
    if (!fs.existsSync(source)) return null;
    const base = sanitize(attachment.filename);
    const name = usedAttachmentNames.has(base.toLowerCase())
      ? dedupe(usedAttachmentNames, `${attachment.hash.slice(0, 8)}-${base}`)
      : dedupe(usedAttachmentNames, base);
    fs.mkdirSync(path.join(dest, 'attachments'), { recursive: true });
    fs.copyFileSync(source, path.join(dest, 'attachments', name));
    exportedByHash.set(attachment.hash, name);
    return name;
  };

  let noteCount = 0;
  for (const note of notesRepo(db).list({
    sort: 'created',
    fetch: Number.MAX_SAFE_INTEGER,
    cursor: null,
  })) {
    const folder = folders.get(note.notebookId) ?? '';

    // Rewrite attachment URLs to relative file paths, copying blobs as found.
    const body = note.body.replace(ATTACHMENT_URL_RE, (url, id: string) => {
      const name = exportAttachment(id as AttachmentId);
      if (name === null) return url; // dangling reference — leave as-is
      const rel = path.posix.relative(folder, `attachments/${name}`);
      return encodePath(rel);
    });

    const frontmatter = formatFrontmatter({
      title: note.title === '' ? undefined : note.title,
      tags: tags.tagsForNote(note.id as NoteId).map((t) => t.name),
      created: note.createdAt,
      updated: note.updatedAt,
      pinned: note.pinned ? true : undefined,
    });

    const dir = path.join(dest, ...(folder === '' ? [] : folder.split('/')));
    fs.mkdirSync(dir, { recursive: true });
    let used = usedNoteNames.get(folder);
    if (!used) {
      used = new Set<string>();
      usedNoteNames.set(folder, used);
    }
    const filename = `${dedupe(used, sanitize(note.title === '' ? 'untitled' : note.title))}.md`;
    fs.writeFileSync(path.join(dir, filename), `${frontmatter}${body}`);
    noteCount += 1;
  }

  return { notes: noteCount, attachments: exportedByHash.size, path: dest };
}
