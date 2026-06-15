/**
 * Story archive format (Epic 19, F1881/F1885/F1886/F1888).
 *
 * A `.fablearchive` is a deterministic ZIP bundling one or more `.fablepack`s
 * plus a fixity manifest (sha256 per pack) — "everything, forever" local
 * preservation. Verification recomputes the fixity; a preservation checklist
 * flags what a pack still needs pinned; a format-version field lets future
 * readers migrate old archives.
 *
 * Built on the hand-written ZIP reader/writer + the .fablepack format.
 */

import { createHash } from 'node:crypto';
import { readZip } from '../../import/lib/zip.js';
import { writeZip, type ZipFile } from '../../import/lib/zip-write.js';
import { unpackFable } from '../fablepack/pack.js';

export const ARCHIVE_FORMAT_VERSION = 1;

export interface ArchiveManifest {
  format: 'fablearchive';
  version: number;
  createdAt: string;
  /** pack file name → sha256 hex (fixity, F1885). */
  fixity: Record<string, string>;
  metadata: Record<string, unknown>;
}

const sha256 = (d: Uint8Array): string => createHash('sha256').update(d).digest('hex');
const enc = (s: string): Buffer => Buffer.from(s, 'utf8');

export interface ArchiveInput {
  packs: { name: string; bytes: Uint8Array }[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

/** Build a deterministic `.fablearchive` with a fixity manifest (F1881/F1885). */
export function buildArchive(input: ArchiveInput): Buffer {
  const packs = input.packs
    .map((p) => ({ name: `packs/${p.name}`, data: Buffer.from(p.bytes) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const fixity: Record<string, string> = {};
  for (const p of packs) fixity[p.name] = sha256(p.data);

  const manifest: ArchiveManifest = {
    format: 'fablearchive',
    version: ARCHIVE_FORMAT_VERSION,
    createdAt: input.createdAt ?? '1970-01-01T00:00:00.000Z',
    fixity,
    metadata: input.metadata ?? {},
  };
  const files: ZipFile[] = [
    { name: 'archive-manifest.json', data: enc(JSON.stringify(manifest)) },
    ...packs,
  ];
  return writeZip(files);
}

export interface ArchiveVerification {
  valid: boolean;
  errors: string[];
  packs: string[];
  version: number;
}

/** Verify an archive's fixity manifest (F1886). */
export function verifyArchive(buffer: Buffer): ArchiveVerification {
  const errors: string[] = [];
  let entries;
  try {
    entries = readZip(buffer).filter((e) => !e.isDirectory);
  } catch (err) {
    return {
      valid: false,
      errors: [`unreadable: ${(err as Error).message}`],
      packs: [],
      version: 0,
    };
  }
  const manifestEntry = entries.find((e) => e.name === 'archive-manifest.json');
  if (!manifestEntry)
    return { valid: false, errors: ['missing archive-manifest.json'], packs: [], version: 0 };

  let manifest: ArchiveManifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8')) as ArchiveManifest;
  } catch {
    return { valid: false, errors: ['manifest is not valid JSON'], packs: [], version: 0 };
  }
  if (manifest.version > ARCHIVE_FORMAT_VERSION) {
    errors.push(
      `archive version ${manifest.version} is newer than supported (${ARCHIVE_FORMAT_VERSION})`,
    );
  }

  const byName = new Map(entries.map((e) => [e.name, e.data]));
  for (const [name, hash] of Object.entries(manifest.fixity)) {
    const data = byName.get(name);
    if (!data) errors.push(`missing pack: ${name}`);
    else if (sha256(data) !== hash) errors.push(`fixity mismatch: ${name}`);
  }
  return {
    valid: errors.length === 0,
    errors,
    packs: Object.keys(manifest.fixity),
    version: manifest.version,
  };
}

export interface ChecklistItem {
  item: string;
  present: boolean;
  note: string;
}

/**
 * Preservation checklist for a pack (F1884): is everything it needs pinned so it
 * plays "forever"? Reads an unpacked pack and reports missing pieces.
 */
export function preservationChecklist(packBytes: Uint8Array): ChecklistItem[] {
  const pack = unpackFable(Buffer.from(packBytes));
  const caps = new Set(pack.manifest.capabilities);
  const assetNames = Object.keys(pack.assets);
  const has = (cond: boolean, item: string, note: string): ChecklistItem => ({
    item,
    present: cond,
    note,
  });
  return [
    has(Object.keys(pack.source).length > 0, 'story source', 'the .fable source is present'),
    has(
      pack.manifest.compat !== undefined,
      'compat range',
      'declares the app version range it targets',
    ),
    has(pack.casting !== null, 'casting', 'voice casting is pinned (for narration)'),
    has(
      !caps.has('audio') || assetNames.some((n) => /\.(wav|ogg|mp3|opus)$/i.test(n)),
      'audio assets',
      'audio capability declared and audio assets pinned',
    ),
    has(
      !caps.has('images') || assetNames.some((n) => /\.(png|jpe?g|webp|svg)$/i.test(n)),
      'image assets',
      'image capability declared and image assets pinned',
    ),
    has(
      Object.keys(pack.manifest.entries).length > 0,
      'fixity hashes',
      'the pack hash tree is present',
    ),
  ];
}
