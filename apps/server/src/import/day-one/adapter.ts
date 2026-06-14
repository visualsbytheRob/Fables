/**
 * Day One importer (F1452, F1453).
 *
 * Day One exports a folder (or `.zip`, extracted first) containing one or more
 * `*.json` journal files plus a `photos/` directory. Each entry becomes a note in
 * a Journal-style notebook with its creation date preserved, its rich metadata
 * (location, weather, starred) rendered as a small block (F1453), and its photos
 * imported as attachments and relinked from the `dayone-moment://` references.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedAsset, StagedDoc } from '../framework/index.js';

export interface DayOneInput {
  /** Server-local path to the extracted Day One export directory (or a single .json). */
  path: string;
}

interface DayOnePhoto {
  identifier?: string;
  md5?: string;
  type?: string;
}

interface DayOneEntry {
  uuid?: string;
  text?: string;
  creationDate?: string;
  modifiedDate?: string;
  tags?: string[];
  starred?: boolean;
  location?: { placeName?: string; localityName?: string; country?: string };
  weather?: { conditionsDescription?: string; temperatureCelsius?: number };
  photos?: DayOnePhoto[];
}

export class DayOneAdapter implements SourceAdapter {
  readonly name = 'day-one';
  constructor(private readonly input: DayOneInput) {}

  stage(): StagedDoc[] {
    const { dir, files } = resolveJournals(this.input.path);
    const photoIndex = indexPhotos(dir);
    const docs: StagedDoc[] = [];
    for (const file of files) {
      const journal = path.basename(file).replace(/\.json$/i, '');
      const parsed = parseJournal(path.join(dir, file));
      parsed.entries?.forEach((entry, i) => docs.push(toDoc(journal, entry, i, photoIndex)));
    }
    return docs;
  }
}

function toDoc(
  journal: string,
  entry: DayOneEntry,
  index: number,
  photoIndex: Map<string, string>,
): StagedDoc {
  const text = entry.text ?? '';
  const assets: StagedAsset[] = [];
  const body = renderBody(text, entry, assets, photoIndex);
  const notebook =
    journal && journal.toLowerCase() !== 'journal' ? `Journal/${journal}` : 'Journal';

  const doc: StagedDoc = {
    sourceId: entry.uuid?.toLowerCase() ?? `${journal}-${index}`,
    title: titleOf(text, entry.creationDate),
    body,
    notebookPath: notebook.split('/'),
    tags: (entry.tags ?? []).filter((t) => typeof t === 'string'),
    assets,
    links: [],
  };
  if (entry.creationDate) doc.createdAt = normalizeDate(entry.creationDate);
  if (entry.modifiedDate) doc.updatedAt = normalizeDate(entry.modifiedDate);
  return doc;
}

/** First non-empty line as title, else the date (Day One entries have no title field). */
function titleOf(text: string, creationDate?: string): string {
  const first = text
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l !== '');
  if (first) return first.slice(0, 120);
  return creationDate ? new Date(creationDate).toISOString().slice(0, 10) : 'Untitled entry';
}

function renderBody(
  text: string,
  entry: DayOneEntry,
  assets: StagedAsset[],
  photoIndex: Map<string, string>,
): string {
  let body = text;

  // Photos (F1453): replace dayone-moment references with asset placeholders.
  (entry.photos ?? []).forEach((photo, i) => {
    const file = photo.md5 ? photoIndex.get(photo.md5) : undefined;
    if (!file) return;
    const ref = `p${i}`;
    const filename = path.basename(file);
    assets.push({ ref, filename, read: () => fs.readFileSync(file) });
    const moment = photo.identifier ? `dayone-moment://${photo.identifier}` : null;
    if (moment && body.includes(moment)) {
      body = body
        .split(`![](${moment})`)
        .join(`{{asset:${ref}}}`)
        .split(moment)
        .join(`{{asset:${ref}}}`);
    } else {
      body += `\n\n{{asset:${ref}}}`;
    }
  });

  // Metadata block (F1453): location, weather, starred.
  const meta: string[] = [];
  const place = entry.location?.placeName ?? entry.location?.localityName;
  if (place) meta.push(`📍 ${[place, entry.location?.country].filter(Boolean).join(', ')}`);
  if (entry.weather?.conditionsDescription) {
    const t = entry.weather.temperatureCelsius;
    meta.push(
      `🌤️ ${entry.weather.conditionsDescription}${t !== undefined ? ` (${Math.round(t)}°C)` : ''}`,
    );
  }
  if (entry.starred) meta.push('⭐ Starred');
  return meta.length > 0 ? `${body.trim()}\n\n---\n${meta.join(' · ')}\n` : body.trim();
}

interface Journal {
  entries?: DayOneEntry[];
}

function parseJournal(file: string): Journal {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Journal;
  } catch {
    throw validation('Day One journal is not valid JSON', { file: path.basename(file) });
  }
}

/** Map photo md5 → absolute file path under photos/. */
function indexPhotos(dir: string): Map<string, string> {
  const index = new Map<string, string>();
  const photosDir = path.join(dir, 'photos');
  if (!fs.existsSync(photosDir)) return index;
  for (const name of fs.readdirSync(photosDir)) {
    // Day One names photos by md5 (e.g. "<md5>.jpeg").
    const md5 = name.replace(/\.[^.]+$/, '').toLowerCase();
    index.set(md5, path.join(photosDir, name));
  }
  return index;
}

function resolveJournals(inputPath: string): { dir: string; files: string[] } {
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
    if (!real.toLowerCase().endsWith('.json')) throw validation('expected a Day One .json export');
    return { dir: path.dirname(real), files: [path.basename(real)] };
  }
  if (stat.isDirectory()) {
    const files = fs
      .readdirSync(real)
      .filter((n) => n.toLowerCase().endsWith('.json'))
      .sort();
    if (files.length === 0) throw validation('no Day One .json journals found in directory');
    return { dir: real, files };
  }
  throw validation('import path must be a Day One export directory or .json file');
}

function normalizeDate(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}
