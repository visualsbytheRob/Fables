/**
 * ENEX parser (shared by Apple Notes via the Exporter app, and Evernote).
 *
 * ENEX is Evernote's export XML: an `<en-export>` of `<note>` elements, each with
 * a `<title>`, an ENML `<content>` (XHTML, in CDATA), timestamps, `<tag>`s, and
 * binary `<resource>`s. It's machine-generated and regular, so targeted
 * extraction is reliable without a full XML stack. Resources are matched to their
 * in-body `<en-media hash="…"/>` references by the MD5 of their bytes.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

export interface EnexResource {
  /** MD5 of the bytes, lowercased hex — the key `<en-media hash>` references. */
  md5: string;
  mime: string;
  filename: string;
  data: Buffer;
}

export interface EnexNote {
  title: string;
  /** ENML (XHTML) body. */
  content: string;
  created?: string | undefined;
  updated?: string | undefined;
  tags: string[];
  resources: EnexResource[];
  /** True when the note contains encrypted (`<en-crypt>`) content — a locked note. */
  encrypted: boolean;
  /** `<note-attributes>` children, e.g. source-url, reminder-time (F1435/F1437). */
  attributes: Record<string, string>;
}

const NOTE_RE = /<note>([\s\S]*?)<\/note>/g;
const RESOURCE_RE = /<resource>([\s\S]*?)<\/resource>/g;

/** Parse an ENEX document (already in memory) into its notes. */
export function parseEnex(xml: string): EnexNote[] {
  const notes: EnexNote[] = [];
  for (const m of xml.matchAll(NOTE_RE)) {
    notes.push(parseNote(m[1]!));
  }
  return notes;
}

/**
 * Stream notes from an ENEX file on disk, one at a time (F1438).
 *
 * Reads the file in fixed chunks and emits each `<note>…</note>` as soon as it's
 * complete, so peak string memory is bounded to roughly one note plus a chunk —
 * the parser never holds a multi-GB export as a single string. (Resource bytes
 * for the current note are still materialized; callers process notes
 * sequentially, keeping overall footprint to one note at a time.)
 */
export function* streamEnexNotes(filePath: string, chunkSize = 1 << 20): Generator<EnexNote> {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(chunkSize);
    let carry = '';
    let read: number;
    while ((read = fs.readSync(fd, buf, 0, chunkSize, null)) > 0) {
      carry += buf.toString('utf8', 0, read);
      let end: number;
      while ((end = carry.indexOf('</note>')) !== -1) {
        const start = carry.indexOf('<note>');
        if (start === -1 || start > end) {
          // Drop content before the closing tag we can't pair (preamble/garbage).
          carry = carry.slice(end + 7);
          continue;
        }
        const block = carry.slice(start + 6, end);
        carry = carry.slice(end + 7);
        yield parseNote(block);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

function parseNote(block: string): EnexNote {
  const title = decodeXml(firstTag(block, 'title') ?? 'Untitled').trim() || 'Untitled';
  const content = extractContent(block);
  const created = normalizeEnexDate(firstTag(block, 'created'));
  const updated = normalizeEnexDate(firstTag(block, 'updated'));
  const tags = [...block.matchAll(/<tag>([\s\S]*?)<\/tag>/g)]
    .map((t) => decodeXml(t[1]!).trim())
    .filter((t) => t !== '');

  const resources: EnexResource[] = [];
  for (const r of block.matchAll(RESOURCE_RE)) {
    const res = parseResource(r[1]!);
    if (res) resources.push(res);
  }

  const note: EnexNote = {
    title,
    content,
    tags,
    resources,
    encrypted: /<en-crypt[\s>]/.test(content),
    attributes: parseAttributes(block),
  };
  if (created !== undefined) note.created = created;
  if (updated !== undefined) note.updated = updated;
  return note;
}

/** Flatten `<note-attributes>` children into a string map (F1435/F1437). */
function parseAttributes(block: string): Record<string, string> {
  const inner = firstTag(block, 'note-attributes');
  if (inner === null) return {};
  const attrs: Record<string, string> = {};
  for (const m of inner.matchAll(/<([a-z][a-z0-9-]*)>([\s\S]*?)<\/\1>/gi)) {
    attrs[m[1]!.toLowerCase()] = decodeXml(m[2]!).trim();
  }
  return attrs;
}

/** `<content>` is CDATA-wrapped ENML; pull the inner XHTML out. */
function extractContent(block: string): string {
  const raw = firstTag(block, 'content');
  if (raw === null) return '';
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(raw);
  return (cdata ? cdata[1]! : raw).trim();
}

function parseResource(block: string): EnexResource | null {
  const dataMatch = /<data[^>]*>([\s\S]*?)<\/data>/.exec(block);
  if (!dataMatch) return null;
  const data = Buffer.from(dataMatch[1]!.replace(/\s+/g, ''), 'base64');
  if (data.length === 0) return null;
  const mime = (firstTag(block, 'mime') ?? 'application/octet-stream').trim();
  const filename = decodeXml(firstTag(block, 'file-name') ?? '').trim() || defaultName(mime, data);
  return { md5: crypto.createHash('md5').update(data).digest('hex'), mime, filename, data };
}

function defaultName(mime: string, data: Buffer): string {
  const ext = mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? 'bin';
  return `${crypto.createHash('md5').update(data).digest('hex').slice(0, 12)}.${ext}`;
}

// ── Small XML helpers ────────────────────────────────────────────────────────

function firstTag(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(block);
  return m ? m[1]! : null;
}

/** ENEX dates are `YYYYMMDDTHHMMSSZ`; normalize to ISO-8601 when recognisable. */
export function normalizeEnexDate(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw.trim());
  if (!m) {
    const d = new Date(raw.trim());
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
}

export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
