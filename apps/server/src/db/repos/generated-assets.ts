/**
 * Generated-asset repository (Epic 19, F1868) — content-addressed image store
 * with provenance (migration 039).
 */

import { createHash } from 'node:crypto';
import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';

export type AssetKind = 'cover' | 'portrait' | 'scene';

export interface GeneratedAsset {
  hash: string;
  kind: AssetKind;
  subjectId: string;
  format: string;
  bytes: number;
  adapter: string;
  prompt: string;
  createdAt: string;
}

interface Row {
  hash: string;
  kind: string;
  subject_id: string;
  format: string;
  bytes: number;
  adapter: string;
  prompt: string;
  created_at: string;
}

const toAsset = (r: Row): GeneratedAsset => ({
  hash: r.hash,
  kind: r.kind as AssetKind,
  subjectId: r.subject_id,
  format: r.format,
  bytes: r.bytes,
  adapter: r.adapter,
  prompt: r.prompt,
  createdAt: r.created_at,
});

export interface StoreAssetInput {
  kind: AssetKind;
  subjectId: string;
  format: string;
  data: Uint8Array;
  adapter: string;
  prompt: string;
}

export function generatedAssetsRepo(db: Db) {
  return {
    /** Store an asset content-addressed by sha256 (dedupes identical bytes). */
    store(input: StoreAssetInput): GeneratedAsset {
      const hash = createHash('sha256').update(input.data).digest('hex');
      const now = nowIso();
      db.prepare(
        `INSERT INTO generated_assets (hash, kind, subject_id, format, bytes, data, adapter, prompt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hash) DO NOTHING`,
      ).run(
        hash,
        input.kind,
        input.subjectId,
        input.format,
        input.data.byteLength,
        Buffer.from(input.data),
        input.adapter,
        input.prompt,
        now,
      );
      return this.meta(hash)!;
    },

    meta(hash: string): GeneratedAsset | null {
      const row = db
        .prepare(
          'SELECT hash, kind, subject_id, format, bytes, adapter, prompt, created_at FROM generated_assets WHERE hash = ?',
        )
        .get(hash) as Row | undefined;
      return row ? toAsset(row) : null;
    },

    data(hash: string): { format: string; bytes: Uint8Array } | null {
      const row = db
        .prepare('SELECT format, data FROM generated_assets WHERE hash = ?')
        .get(hash) as { format: string; data: Buffer } | undefined;
      return row ? { format: row.format, bytes: new Uint8Array(row.data) } : null;
    },

    listFor(kind: AssetKind, subjectId: string): GeneratedAsset[] {
      return (
        db
          .prepare(
            'SELECT hash, kind, subject_id, format, bytes, adapter, prompt, created_at FROM generated_assets WHERE kind = ? AND subject_id = ? ORDER BY created_at DESC',
          )
          .all(kind, subjectId) as Row[]
      ).map(toAsset);
    },
  };
}

export type GeneratedAssetsRepo = ReturnType<typeof generatedAssetsRepo>;
