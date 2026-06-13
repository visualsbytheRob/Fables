/**
 * Embedding job queue (F724–F729):
 *
 * Synchronous batched execution — correct for a single-user app where SQLite
 * can't do parallel writes anyway. Jobs are de-duplicated by sourceId so rapid
 * consecutive edits collapse into one embed pass.
 *
 * Debounce: callers typically call `enqueue` on note save; the queue processes
 * on the next microtask turn (drain() is called lazily). For an interactive app
 * this is fine — embed latency is invisible behind the save round-trip.
 *
 * CPU throttling (F728): each batch yields to the event loop via setImmediate,
 * preventing the embedding loop from blocking HTTP handlers.
 */

import { embeddingsRepo } from '../db/repos/embeddings.js';
import type { Db } from '../db/connection.js';
import { chunkNote } from './chunker.js';
import type { EmbeddingProvider } from './embedding-provider.js';

export interface EmbedJob {
  sourceId: string;
  sourceType: 'note' | 'entity' | 'scene';
  title: string;
  body: string;
}

export interface QueueStatus {
  queueDepth: number;
  processing: boolean;
  lastProcessedAt: string | null;
}

export interface BackfillProgress {
  total: number;
  done: number;
  skipped: number;
  errors: number;
}

export class EmbeddingQueue {
  private queue = new Map<string, EmbedJob>(); // deduped by sourceId
  private processing = false;
  private lastProcessedAt: string | null = null;
  private readonly BATCH_SIZE = 16;

  constructor(
    private readonly db: Db,
    private readonly provider: EmbeddingProvider,
  ) {}

  /** Enqueue a re-embed for a source. Collapses duplicates. */
  enqueue(job: EmbedJob): void {
    this.queue.set(job.sourceId, job);
    // Lazy drain — runs after current call stack
    if (!this.processing) {
      setImmediate(() => void this.drain());
    }
  }

  /** Status for /embeddings/status endpoint. */
  status(): QueueStatus {
    return {
      queueDepth: this.queue.size,
      processing: this.processing,
      lastProcessedAt: this.lastProcessedAt,
    };
  }

  /** Process all queued jobs in batches, yielding between batches. */
  async drain(): Promise<void> {
    if (this.processing || this.queue.size === 0) return;
    this.processing = true;
    try {
      while (this.queue.size > 0) {
        const batch = [...this.queue.values()].slice(0, this.BATCH_SIZE);
        for (const key of batch.map((j) => j.sourceId)) this.queue.delete(key);
        await this.processBatch(batch);
        // Yield to event loop between batches (CPU throttling, F728)
        if (this.queue.size > 0) {
          await new Promise<void>((r) => setImmediate(r));
        }
      }
    } catch {
      // Graceful: swallow errors (e.g. DB closed during test teardown) —
      // the queue will be empty after the app closes.
      this.queue.clear();
    } finally {
      this.processing = false;
      this.lastProcessedAt = new Date().toISOString();
    }
  }

  private async processBatch(jobs: EmbedJob[]): Promise<void> {
    const repo = embeddingsRepo(this.db);
    for (const job of jobs) {
      const chunks = chunkNote(job.sourceId, job.title, job.body, job.sourceType);
      const texts = chunks.map((c) => c.text);
      let vectors: number[][];
      try {
        vectors = await this.provider.embed(texts);
      } catch {
        // Graceful: skip this source on embed failure
        continue;
      }
      // Delete old embeddings for this source+provider, then upsert new
      repo.deleteBySource(job.sourceId, job.sourceType, this.provider.id);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const vector = vectors[i]!;
        repo.upsert({
          sourceId: job.sourceId,
          sourceType: job.sourceType,
          chunkIndex: chunk.index,
          chunkHash: chunk.hash,
          providerId: this.provider.id,
          vector,
        });
      }
    }
  }

  /**
   * Backfill: embed all notes (and optionally entities/scenes) that are not
   * yet embedded for the current provider. Returns progress stats.
   * Calls `onProgress` callback after each batch (F726).
   */
  async backfill(
    onProgress?: (p: BackfillProgress) => void,
  ): Promise<BackfillProgress> {
    const repo = embeddingsRepo(this.db);

    // Collect all un-embedded notes
    const notes = this.db
      .prepare(
        `SELECT id, title, body FROM notes WHERE trashed_at IS NULL
         AND id NOT IN (
           SELECT source_id FROM embeddings
           WHERE provider_id = ? AND source_type = 'note'
         )`,
      )
      .all(this.provider.id) as { id: string; title: string; body: string }[];

    const progress: BackfillProgress = {
      total: notes.length,
      done: 0,
      skipped: 0,
      errors: 0,
    };

    for (let i = 0; i < notes.length; i += this.BATCH_SIZE) {
      const batch = notes.slice(i, i + this.BATCH_SIZE);
      for (const note of batch) {
        const chunks = chunkNote(note.id, note.title, note.body, 'note');
        const texts = chunks.map((c) => c.text);
        try {
          const vectors = await this.provider.embed(texts);
          for (let ci = 0; ci < chunks.length; ci++) {
            const chunk = chunks[ci]!;
            const inserted = repo.upsert({
              sourceId: note.id,
              sourceType: 'note',
              chunkIndex: chunk.index,
              chunkHash: chunk.hash,
              providerId: this.provider.id,
              vector: vectors[ci]!,
            });
            if (!inserted) progress.skipped++;
          }
          progress.done++;
        } catch {
          progress.errors++;
        }
      }
      onProgress?.(progress);
      // Yield between batches
      await new Promise<void>((r) => setImmediate(r));
    }

    return progress;
  }
}
