/**
 * Email importer (F1466).
 *
 * Accepts a single `.eml`, a single `.mbox`, or a directory of `.eml` files.
 * Each message becomes one StagedDoc in notebookPath ['Email'].
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedDoc } from '../framework/index.js';

export interface EmailInput {
  path: string;
}

export class EmailAdapter implements SourceAdapter {
  readonly name = 'email';
  constructor(private readonly input: EmailInput) {}

  stage(): StagedDoc[] {
    const real = resolvePath(this.input.path);
    const stat = fs.statSync(real);

    if (stat.isDirectory()) {
      const files = fs
        .readdirSync(real)
        .filter((n) => n.toLowerCase().endsWith('.eml'))
        .sort()
        .map((n) => path.join(real, n));
      const docs: StagedDoc[] = [];
      let idx = 0;
      for (const f of files) {
        const raw = fs.readFileSync(f, 'utf8');
        docs.push(...parseMessages(raw, idx));
        idx += docs.length;
      }
      return docs;
    }

    const raw = fs.readFileSync(real, 'utf8');
    const lower = real.toLowerCase();
    if (lower.endsWith('.mbox')) {
      return parseMessages(raw, 0);
    }
    // single .eml
    return parseMessages(raw, 0);
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
  const lower = real.toLowerCase();
  if (!lower.endsWith('.eml') && !lower.endsWith('.mbox')) {
    throw validation('expected a .eml file, a .mbox file, or a directory of .eml files');
  }
  return real;
}

// ── mbox splitter ──────────────────────────────────────────────────────────

/**
 * Split an mbox file on "From " separator lines.
 * For a single .eml there are no separators so the whole text is returned as one.
 */
function splitMbox(text: string): string[] {
  // mbox "From " line: starts at column 0, ends with a 4-digit year
  const separatorRe = /^From .*\d{4}$/m;
  if (!separatorRe.test(text)) {
    // single message (eml) or mbox with only one message and no separator
    return [text];
  }
  const parts = text.split(/^(?=From .*\d{4}$)/m);
  return parts.filter((p) => p.trim().length > 0);
}

// ── RFC-822 header / body split ────────────────────────────────────────────

interface ParsedMessage {
  headers: Record<string, string>;
  body: string;
}

function unfoldHeaders(raw: string): string {
  // RFC 2822 unfolding: CRLF + WSP → single space
  return raw.replace(/\r?\n[ \t]+/g, ' ');
}

function parseMessage(text: string): ParsedMessage {
  // Strip mbox "From " envelope line if present
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  if (lines[0]?.startsWith('From ')) start = 1;

  const rawText = lines.slice(start).join('\n');
  // Headers end at first blank line
  const blankIdx = rawText.indexOf('\n\n');
  const headerSection = blankIdx >= 0 ? rawText.slice(0, blankIdx) : rawText;
  const bodySection = blankIdx >= 0 ? rawText.slice(blankIdx + 2) : '';

  const unfolded = unfoldHeaders(headerSection);
  const headers: Record<string, string> = {};
  for (const line of unfolded.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();
    if (key && !(key in headers)) {
      headers[key] = val;
    }
  }

  return { headers, body: bodySection };
}

// ── Multipart body extraction ──────────────────────────────────────────────

/**
 * Best-effort: if the Content-Type header declares a boundary, try to extract
 * the first text/plain part. Otherwise return the raw body.
 * Returns { text, lossy } where lossy is true if we stripped non-plain parts.
 */
function extractBody(
  headers: Record<string, string>,
  rawBody: string,
): { text: string; lossy: boolean } {
  const ct = headers['content-type'] ?? '';
  const isMultipart = /multipart\//i.test(ct);
  const isHtml = /text\/html/i.test(ct);

  if (!isMultipart && !isHtml) {
    return { text: rawBody, lossy: false };
  }

  if (isHtml) {
    // strip simple HTML tags for best-effort plain text
    const stripped = rawBody
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    return { text: stripped, lossy: true };
  }

  // multipart: extract boundary
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(ct);
  if (!boundaryMatch) return { text: rawBody, lossy: true };
  const boundary = boundaryMatch[1]!;

  const parts = rawBody.split(new RegExp(`--${escapeRegex(boundary)}(?:--)?`));
  for (const part of parts) {
    if (!part.trim() || part.trim() === '--') continue;
    const blankIdx = part.indexOf('\n\n');
    if (blankIdx < 0) continue;
    const partHeaders = part.slice(0, blankIdx);
    const partBody = part.slice(blankIdx + 2);
    if (/text\/plain/i.test(partHeaders)) {
      return { text: partBody, lossy: true };
    }
  }

  // fallback: strip tags
  const stripped = rawBody.replace(/<[^>]+>/g, '');
  return { text: stripped, lossy: true };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Message → StagedDoc ───────────────────────────────────────────────────

function messageToDoc(msg: ParsedMessage, index: number): StagedDoc {
  const { headers, body } = msg;
  const subject = headers['subject'] ?? '(no subject)';
  const from = headers['from'] ?? '';
  const to = headers['to'] ?? '';
  const dateHeader = headers['date'] ?? '';
  const messageId = headers['message-id']?.replace(/[<>]/g, '').trim().toLowerCase();
  const sourceId = messageId ?? `email-${index}`;

  const { text: bodyText, lossy } = extractBody(headers, body);

  const headerBlock = [`**From:** ${from}`, `**To:** ${to}`, `**Date:** ${dateHeader}`].join('\n');

  const fullBody = `${headerBlock}\n\n---\n\n${bodyText.trim()}`;

  let createdAt: string | undefined;
  if (dateHeader) {
    const d = new Date(dateHeader);
    if (!Number.isNaN(d.getTime())) createdAt = d.toISOString();
  }

  const doc: StagedDoc = {
    sourceId,
    title: subject,
    body: fullBody,
    notebookPath: ['Email'],
    tags: [],
    assets: [],
    links: [],
  };
  if (createdAt !== undefined) doc.createdAt = createdAt;
  if (lossy) doc.metadata = { lossy: ['multipart/HTML email simplified to text'] };
  return doc;
}

// ── Top-level parser ───────────────────────────────────────────────────────

function parseMessages(text: string, startIndex: number): StagedDoc[] {
  const rawMessages = splitMbox(text);
  const docs: StagedDoc[] = [];
  let idx = startIndex;
  for (const raw of rawMessages) {
    const msg = parseMessage(raw);
    docs.push(messageToDoc(msg, idx));
    idx += 1;
  }
  return docs;
}
