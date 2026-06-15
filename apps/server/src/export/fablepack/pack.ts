/**
 * .fablepack container format (Epic 19, F1801–F1808).
 *
 * A .fablepack is a deterministic ZIP bundling everything needed to play a fable
 * elsewhere: story source, optional bytecode, casting, assets, and a manifest
 * with capability requirements, version compatibility, content warnings, and a
 * sha256 hash tree (optionally HMAC-signed). Packing is reproducible — the same
 * input always yields byte-identical output (entries are sorted; the ZIP writer
 * uses zero timestamps), so a pack's hash is a stable identity.
 *
 * Built on the hand-written ZIP reader/writer — no new dependencies.
 */

import { createHash, createHmac } from 'node:crypto';
import { readZip } from '../../import/lib/zip.js';
import { writeZip, type ZipFile } from '../../import/lib/zip-write.js';

export const FABLEPACK_FORMAT_VERSION = 1;

export type Capability = 'audio' | 'ai' | 'knowledge' | 'images' | 'soundscape';

export interface FablePackManifest {
  format: 'fablepack';
  version: number;
  story: { id: string; title: string; description: string };
  /** Release name/label (F1841). */
  release: string;
  /** Capabilities required to play fully (F1804). */
  capabilities: Capability[];
  /** Compatible app schema-version range (F1807). */
  compat: { min: number; max: number | null };
  /** Content warnings (F1806). */
  contentWarnings: string[];
  /** entry path → sha256 hex (F1808 hash tree). */
  entries: Record<string, string>;
  /** Optional HMAC-SHA256 over the canonical manifest (F1808). */
  signature?: string;
  createdAt: string;
}

export interface PackInput {
  story: { id: string; title: string; description?: string };
  release?: string;
  /** path → .fable source. */
  source: Record<string, string>;
  bytecode?: Uint8Array | undefined;
  casting?: unknown;
  /** asset name → bytes. */
  assets?: Record<string, Uint8Array>;
  capabilities?: Capability[];
  compat?: { min: number; max: number | null };
  contentWarnings?: string[];
  /** Fixed timestamp for reproducible packs; defaults to the epoch. */
  createdAt?: string;
  /** When set, the manifest is HMAC-signed with this key (F1808). */
  signingKey?: string;
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');
const enc = (s: string): Buffer => Buffer.from(s, 'utf8');

/** Canonical JSON of the manifest minus its signature, for hashing/signing. */
function canonicalManifest(m: FablePackManifest): string {
  const { signature: _sig, ...rest } = m;
  void _sig;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

function sign(manifest: FablePackManifest, key: string): string {
  return createHmac('sha256', key).update(canonicalManifest(manifest)).digest('hex');
}

/** Pack a fable into a deterministic .fablepack buffer (F1801/F1802/F1808). */
export function packFable(input: PackInput): Buffer {
  // Collect content entries (everything except the manifest) under stable paths.
  const content: ZipFile[] = [];
  for (const [path, src] of Object.entries(input.source)) {
    content.push({ name: `story/${path}`, data: enc(src) });
  }
  if (input.bytecode) content.push({ name: 'bytecode.bin', data: Buffer.from(input.bytecode) });
  if (input.casting !== undefined) {
    content.push({ name: 'casting.json', data: enc(JSON.stringify(input.casting)) });
  }
  for (const [name, bytes] of Object.entries(input.assets ?? {})) {
    content.push({ name: `assets/${name}`, data: Buffer.from(bytes) });
  }

  // Hash tree over content entries, sorted by name for determinism.
  content.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const entries: Record<string, string> = {};
  for (const e of content) entries[e.name] = sha256(e.data);

  const manifest: FablePackManifest = {
    format: 'fablepack',
    version: FABLEPACK_FORMAT_VERSION,
    story: {
      id: input.story.id,
      title: input.story.title,
      description: input.story.description ?? '',
    },
    release: input.release ?? 'draft',
    capabilities: input.capabilities ?? [],
    compat: input.compat ?? { min: 1, max: null },
    contentWarnings: input.contentWarnings ?? [],
    entries,
    createdAt: input.createdAt ?? '1970-01-01T00:00:00.000Z',
  };
  if (input.signingKey) manifest.signature = sign(manifest, input.signingKey);

  // manifest.json first, then sorted content — full ordering is deterministic.
  const files: ZipFile[] = [
    { name: 'manifest.json', data: enc(JSON.stringify(manifest)) },
    ...content,
  ];
  return writeZip(files);
}

export interface UnpackedPack {
  manifest: FablePackManifest;
  source: Record<string, string>;
  casting: unknown;
  bytecode: Buffer | null;
  assets: Record<string, Buffer>;
}

/** Read a .fablepack back into its parts (F1803). */
export function unpackFable(buffer: Buffer): UnpackedPack {
  const entries = readZip(buffer).filter((e) => !e.isDirectory);
  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) throw new Error('not a .fablepack: missing manifest.json');
  const manifest = JSON.parse(manifestEntry.data.toString('utf8')) as FablePackManifest;
  if (manifest.format !== 'fablepack') throw new Error('not a .fablepack: bad format tag');

  const source: Record<string, string> = {};
  const assets: Record<string, Buffer> = {};
  let casting: unknown = null;
  let bytecode: Buffer | null = null;
  for (const e of entries) {
    if (e.name.startsWith('story/'))
      source[e.name.slice('story/'.length)] = e.data.toString('utf8');
    else if (e.name.startsWith('assets/')) assets[e.name.slice('assets/'.length)] = e.data;
    else if (e.name === 'casting.json') casting = JSON.parse(e.data.toString('utf8'));
    else if (e.name === 'bytecode.bin') bytecode = e.data;
  }
  return { manifest, source, casting, bytecode, assets };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** True when a signature was present and verified with the given key. */
  signatureValid: boolean | null;
}

/** Validate a pack's hash tree + (optionally) signature (F1806/F1808/F1810). */
export function validatePack(buffer: Buffer, signingKey?: string): ValidationResult {
  const errors: string[] = [];
  let signatureValid: boolean | null = null;
  let entries;
  try {
    entries = readZip(buffer).filter((e) => !e.isDirectory);
  } catch (err) {
    return {
      valid: false,
      errors: [`unreadable archive: ${(err as Error).message}`],
      signatureValid,
    };
  }
  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) return { valid: false, errors: ['missing manifest.json'], signatureValid };

  let manifest: FablePackManifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8')) as FablePackManifest;
  } catch {
    return { valid: false, errors: ['manifest.json is not valid JSON'], signatureValid };
  }

  // Every manifest entry must exist and match its hash; no undeclared content.
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  for (const [name, hash] of Object.entries(manifest.entries)) {
    const data = byName.get(name);
    if (!data) errors.push(`missing entry: ${name}`);
    else if (sha256(data) !== hash) errors.push(`hash mismatch: ${name}`);
  }
  for (const e of entries) {
    if (e.name === 'manifest.json') continue;
    if (!(e.name in manifest.entries)) errors.push(`undeclared entry: ${e.name}`);
  }

  if (manifest.signature !== undefined && signingKey !== undefined) {
    signatureValid = sign(manifest, signingKey) === manifest.signature;
    if (!signatureValid) errors.push('signature does not verify');
  }

  return { valid: errors.length === 0, errors, signatureValid };
}
