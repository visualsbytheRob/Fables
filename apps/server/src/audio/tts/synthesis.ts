/**
 * Synthesis pipeline (F1603 caching, F1607 priority queue).
 *
 * Two collaborating pieces sit between a caller and a TtsRuntime:
 *
 *   SynthesisCache  — content-addressed by a hash of (text, voice, rate, pitch).
 *                     A passage read twice is rendered once; the second read is a
 *                     pure DB hit, instant and offline (F1603).
 *   SynthesisQueue  — a priority queue that serialises engine calls so a long
 *                     document render can't starve a "speak this selection now"
 *                     request. Higher priority runs first; FIFO within a priority
 *                     (F1607).
 *
 * `synthesizeCached` ties them together: cache-check → enqueue → render → store.
 */

import { createHash } from 'node:crypto';
import type { Db } from '../../db/connection.js';
import type { AudioFormat, SynthesisRequest, SynthesisResult } from './adapter.js';
import type { TtsRuntime } from './runtime.js';

/** Stable content hash for a synthesis request (F1603). */
export function synthHash(req: SynthesisRequest): string {
  const key = JSON.stringify({
    text: req.text,
    voiceId: req.voiceId ?? '',
    rate: req.rate ?? 1,
    pitch: req.pitch ?? 1,
  });
  return createHash('sha256').update(key).digest('hex');
}

interface CacheRow {
  voice_id: string;
  format: string;
  sample_rate: number;
  duration_ms: number | null;
  audio: Buffer;
}

/** Content-addressed audio cache backed by the tts_cache table (F1603). */
export class SynthesisCache {
  constructor(private readonly db: Db) {}

  get(hash: string): SynthesisResult | null {
    const row = this.db
      .prepare(
        'SELECT voice_id, format, sample_rate, duration_ms, audio FROM tts_cache WHERE hash = ?',
      )
      .get(hash) as CacheRow | undefined;
    if (!row) return null;
    this.db
      .prepare('UPDATE tts_cache SET last_used = ? WHERE hash = ?')
      .run(new Date().toISOString(), hash);
    return {
      audio: new Uint8Array(row.audio),
      format: row.format as AudioFormat,
      sampleRate: row.sample_rate,
      voiceId: row.voice_id,
      ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    };
  }

  put(hash: string, result: SynthesisResult): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO tts_cache
           (hash, voice_id, format, sample_rate, duration_ms, bytes, audio, created_at, last_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hash) DO UPDATE SET last_used = excluded.last_used`,
      )
      .run(
        hash,
        result.voiceId,
        result.format,
        result.sampleRate,
        result.durationMs ?? null,
        result.audio.byteLength,
        Buffer.from(result.audio),
        now,
        now,
      );
  }

  /** Total bytes held in the cache — for local storage reporting. */
  totalBytes(): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM tts_cache').get() as {
      n: number;
    };
    return row.n;
  }

  /** Evict least-recently-used entries until the cache fits `maxBytes`. */
  evictToFit(maxBytes: number): number {
    let removed = 0;
    while (this.totalBytes() > maxBytes) {
      const victim = this.db
        .prepare('SELECT hash, bytes FROM tts_cache ORDER BY last_used ASC LIMIT 1')
        .get() as { hash: string; bytes: number } | undefined;
      if (!victim) break;
      this.db.prepare('DELETE FROM tts_cache WHERE hash = ?').run(victim.hash);
      removed += victim.bytes;
    }
    return removed;
  }
}

// ── Priority queue (F1607) ───────────────────────────────────────────────────

type Task<T> = {
  priority: number;
  seq: number;
  run: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

/**
 * A single-flight priority queue. Tasks are run one at a time; the highest
 * priority pending task goes next, ties broken by insertion order (FIFO). This
 * keeps a foreground "speak now" ahead of a background document render without
 * letting either block the event loop.
 */
export class SynthesisQueue {
  private readonly pending: Task<unknown>[] = [];
  private running = false;
  private seq = 0;

  /** Number of tasks waiting to run (excludes the in-flight one). */
  get size(): number {
    return this.pending.length;
  }

  /** Enqueue `run` at `priority` (higher runs first; default 0). */
  enqueue<T>(run: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: Task<T> = { priority, seq: this.seq++, run, resolve, reject };
      // Insert keeping the array sorted: highest priority first, then FIFO.
      let i = this.pending.length;
      while (i > 0) {
        const prev = this.pending[i - 1]!;
        if (prev.priority > priority || (prev.priority === priority && prev.seq < task.seq)) break;
        i--;
      }
      this.pending.splice(i, 0, task as Task<unknown>);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length > 0) {
        const task = this.pending.shift()!;
        try {
          task.resolve(await task.run());
        } catch (err) {
          task.reject(err);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface CachedSynthesisOptions {
  /** Higher runs sooner in the shared queue (F1607). Default 0. */
  priority?: number;
  /** Skip the cache read (force a fresh render); the result is still stored. */
  noCache?: boolean;
}

export interface CachedSynthesisResult extends SynthesisResult {
  /** Whether this came from the cache (F1603). */
  cached: boolean;
}

/**
 * Synthesize `req`, served from the cache when possible and otherwise rendered
 * through `runtime` (serialised by `queue`) and stored for next time.
 */
export async function synthesizeCached(
  runtime: TtsRuntime,
  cache: SynthesisCache,
  queue: SynthesisQueue,
  req: SynthesisRequest,
  opts: CachedSynthesisOptions = {},
): Promise<CachedSynthesisResult> {
  const hash = synthHash(req);
  if (!opts.noCache) {
    const hit = cache.get(hash);
    if (hit) return { ...hit, cached: true };
  }
  const result = await queue.enqueue(() => runtime.synthesize(req), opts.priority ?? 0);
  cache.put(hash, result);
  return { ...result, cached: false };
}
