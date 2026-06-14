/**
 * ICS calendar importer (F1465).
 *
 * Accepts a single `.ics` file and maps each VEVENT to one StagedDoc
 * in notebookPath ['Calendar'].
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedDoc } from '../framework/index.js';

export interface IcsInput {
  path: string;
}

export class IcsAdapter implements SourceAdapter {
  readonly name = 'ics';
  constructor(private readonly input: IcsInput) {}

  stage(): StagedDoc[] {
    const real = resolvePath(this.input.path);
    const text = fs.readFileSync(real, 'utf8');
    return parseIcs(text);
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
  if (!real.toLowerCase().endsWith('.ics')) {
    throw validation('expected a .ics file');
  }
  return real;
}

// ── ICS line unfolding ─────────────────────────────────────────────────────

function unfold(text: string): string {
  // RFC 5545 §3.1: a CRLF followed by a single WSP character is a fold
  return text.replace(/\r?\n[ \t]/g, '');
}

// ── Property value unescaping ──────────────────────────────────────────────

function unescapeValue(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// ── Date parser ────────────────────────────────────────────────────────────

/**
 * Parse ICS date/datetime values.
 * Formats: YYYYMMDD, YYYYMMDDTHHMMSS, YYYYMMDDTHHMMSSZ, or ISO-8601.
 */
function parseIcsDate(raw: string): string | undefined {
  // Strip VALUE=DATE: and TZID=... parameter prefixes (they appear after ; in property name)
  // raw here is already the value part (after the colon)
  const v = raw.trim();
  // YYYYMMDDTHHMMSS[Z]
  const dtMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (dtMatch) {
    const [, yr, mo, dy, hh, mm, ss, z] = dtMatch;
    const iso = `${yr}-${mo}-${dy}T${hh}:${mm}:${ss}${z ? 'Z' : ''}`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  // YYYYMMDD
  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateMatch) {
    const [, yr, mo, dy] = dateMatch;
    const d = new Date(`${yr}-${mo}-${dy}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  // Fallback: try standard Date parse
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// ── VEVENT → StagedDoc ────────────────────────────────────────────────────

interface VEvent {
  SUMMARY?: string;
  DTSTART?: string;
  DTEND?: string;
  DESCRIPTION?: string;
  LOCATION?: string;
  UID?: string;
}

function veventToDoc(ev: VEvent, index: number): StagedDoc {
  const title = ev.SUMMARY?.trim() || 'Event';
  const uid = ev.UID?.trim().toLowerCase() || `event-${index}`;
  const sourceId = uid;

  const startIso = ev.DTSTART ? parseIcsDate(ev.DTSTART) : undefined;
  const endIso = ev.DTEND ? parseIcsDate(ev.DTEND) : undefined;

  const bodyParts: string[] = [];
  const dateRange = [startIso ?? ev.DTSTART ?? '', endIso ?? ev.DTEND ?? '']
    .filter(Boolean)
    .join('–');
  if (dateRange) bodyParts.push(`🗓 ${dateRange}`);
  if (ev.LOCATION?.trim()) bodyParts.push(`📍 ${ev.LOCATION.trim()}`);
  if (ev.DESCRIPTION?.trim()) {
    bodyParts.push('');
    bodyParts.push(unescapeValue(ev.DESCRIPTION.trim()));
  }
  const body = bodyParts.join('\n');

  const doc: StagedDoc = {
    sourceId,
    title,
    body,
    notebookPath: ['Calendar'],
    tags: [],
    assets: [],
    links: [],
  };
  if (startIso !== undefined) doc.createdAt = startIso;
  return doc;
}

// ── ICS parser ─────────────────────────────────────────────────────────────

function parseIcs(text: string): StagedDoc[] {
  const unfolded = unfold(text);
  const docs: StagedDoc[] = [];
  let index = 0;

  // Find all VEVENT blocks
  const veventRe = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let m: RegExpExecArray | null;
  while ((m = veventRe.exec(unfolded)) !== null) {
    const block = m[1] ?? '';
    const ev: VEvent = {};

    for (const line of block.split(/\r?\n/)) {
      // Property line: NAME;params:VALUE
      const colonIdx = line.indexOf(':');
      if (colonIdx < 0) continue;
      const namePart = line.slice(0, colonIdx);
      const value = line.slice(colonIdx + 1);
      // Extract base property name (strip ;params)
      const baseName = namePart.split(';')[0]?.toUpperCase() ?? '';
      switch (baseName) {
        case 'SUMMARY':
          ev.SUMMARY = value;
          break;
        case 'DTSTART':
          ev.DTSTART = value;
          break;
        case 'DTEND':
          ev.DTEND = value;
          break;
        case 'DESCRIPTION':
          ev.DESCRIPTION = value;
          break;
        case 'LOCATION':
          ev.LOCATION = value;
          break;
        case 'UID':
          ev.UID = value;
          break;
      }
    }

    docs.push(veventToDoc(ev, index));
    index += 1;
  }

  return docs;
}
