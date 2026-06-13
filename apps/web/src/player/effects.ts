/**
 * VM host-effect dispatcher (F613/F614/F631–F638 web halves). The player runs
 * the forge VM client-side; this module collects the encounter / reveal /
 * journal / entity_set events its host hooks emit and POSTs them to
 * `/stories/:id/effects` as one batch per turn.
 *
 * - One batch per flush (per turn) keeps daily-note journal writes quiet
 *   (server F638 batches journal lines per ingested batch).
 * - Idempotency keys are derived from (playthrough, turn, event content), so
 *   rewind/restore replays — which re-fire host effects deterministically —
 *   post the same keys and the server replays the stored result instead of
 *   double-applying anything.
 * - Offline queueing: network failures park the batch in localStorage and the
 *   queue retries on the next flush / reconnect. Server-rejected batches
 *   (validation, forbidden journal writes) are dropped, not retried forever.
 */
import { api, ApiRequestError } from '../api/client.js';

export type EffectEvent =
  | { type: 'journal'; payload: { text: string; scene?: string; choice?: string } }
  | { type: 'entity_set'; payload: { entity: string; field: string; value: unknown } }
  | { type: 'encounter'; payload: { entity: string } }
  | { type: 'reveal'; payload: { entity: string; field: string } };

export interface EffectBatch {
  playthroughId: string;
  idempotencyKey: string;
  events: EffectEvent[];
}

export interface EffectBatchResult {
  storyId: string;
  playthroughId: string;
  idempotencyKey: string;
  replayed: boolean;
  applied: number;
  results: Record<string, unknown>[];
}

/** One spoiler-safe codex entry (server F611–F620). */
export interface CodexEntry {
  entryId: string;
  entityId: string;
  type: 'character' | 'place' | 'item' | 'faction' | 'custom';
  name: string;
  noteId: string | null;
  metAt: string;
  encounters: number;
  revealedFields: Record<string, unknown>;
}

export interface CodexData {
  storyId: string;
  playthroughId: string;
  entries: CodexEntry[];
}

export const effectsApi = {
  post: (storyId: string, batch: EffectBatch) =>
    api.post<EffectBatchResult>(`/stories/${storyId}/effects`, batch),
  codex: (storyId: string, playthroughId: string) =>
    api.get<CodexData>(
      `/stories/${storyId}/codex?playthroughId=${encodeURIComponent(playthroughId)}`,
    ),
};

/* ── idempotency keys (F638) ───────────────────────────────────────────── */

/** FNV-1a over the serialized events: stable for identical replays. */
export function eventsHash(events: readonly EffectEvent[]): string {
  const text = JSON.stringify(events);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Idempotency key for one turn's batch: replays collide, new content doesn't. */
export function batchKey(
  playthroughId: string,
  turn: number,
  events: readonly EffectEvent[],
): string {
  return `${playthroughId}:t${turn}:${eventsHash(events)}`;
}

/* ── playthrough identity ──────────────────────────────────────────────── */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultStorage = (): StorageLike | null =>
  typeof localStorage === 'undefined' ? null : localStorage;

const playthroughKey = (storyId: string): string => `fables.playthrough.${storyId}`;

const makePlaythroughId = (): string =>
  `pt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * The active playthrough id for a story (created on demand). Restores reuse
 * the stored id so the codex and effect history stay attached to the run.
 */
export function currentPlaythrough(
  storyId: string,
  store: StorageLike | null = defaultStorage(),
): string {
  const existing = store?.getItem(playthroughKey(storyId));
  if (existing !== null && existing !== undefined && existing !== '') return existing;
  const id = makePlaythroughId();
  store?.setItem(playthroughKey(storyId), id);
  return id;
}

/** Start-from-the-beginning mints a fresh playthrough (fresh codex, F612). */
export function newPlaythrough(
  storyId: string,
  store: StorageLike | null = defaultStorage(),
): string {
  const id = makePlaythroughId();
  store?.setItem(playthroughKey(storyId), id);
  return id;
}

/* ── the dispatcher ────────────────────────────────────────────────────── */

const queueKey = (storyId: string): string => `fables.effects.queue.${storyId}`;

function loadQueue(storyId: string, store: StorageLike | null): EffectBatch[] {
  if (store === null) return [];
  try {
    const raw = store.getItem(queueKey(storyId));
    const parsed = raw === null ? [] : (JSON.parse(raw) as unknown);
    return Array.isArray(parsed) ? (parsed as EffectBatch[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(storyId: string, queue: readonly EffectBatch[], store: StorageLike | null): void {
  try {
    if (queue.length === 0) store?.removeItem(queueKey(storyId));
    else store?.setItem(queueKey(storyId), JSON.stringify(queue));
  } catch {
    /* storage full — effects are best-effort offline */
  }
}

export type PostBatch = (storyId: string, batch: EffectBatch) => Promise<unknown>;

export interface DispatcherOptions {
  storyId: string;
  playthroughId: string;
  /** Injectable transport (tests); defaults to the real effects API. */
  post?: PostBatch;
  storage?: StorageLike | null;
  /** Called after any batch lands on the server (codex refetch hook). */
  onDelivered?: () => void;
}

/**
 * Collects host events between turns and ships one idempotent batch per
 * flush. Undeliverable batches queue in localStorage and retry on the next
 * flush or an explicit `retryQueued()` (the player wires `online`).
 */
export class EffectsDispatcher {
  private readonly storyId: string;
  private readonly playthroughId: string;
  private readonly post: PostBatch;
  private readonly storage: StorageLike | null;
  private readonly onDelivered: (() => void) | undefined;
  private buffer: EffectEvent[] = [];
  private sending = false;

  constructor(options: DispatcherOptions) {
    this.storyId = options.storyId;
    this.playthroughId = options.playthroughId;
    this.post = options.post ?? ((storyId, batch) => effectsApi.post(storyId, batch));
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.onDelivered = options.onDelivered;
  }

  /** Buffer one host event; nothing is sent until `flush(turn)`. */
  enqueue(event: EffectEvent): void {
    this.buffer.push(event);
  }

  get pending(): number {
    return this.buffer.length;
  }

  get queuedBatches(): number {
    return loadQueue(this.storyId, this.storage).length;
  }

  /**
   * Ship the buffered events as one batch keyed to `turn`, then drain any
   * previously queued batches. Safe to call with an empty buffer.
   */
  async flush(turn: number): Promise<void> {
    if (this.buffer.length > 0) {
      const events = this.buffer;
      this.buffer = [];
      const batch: EffectBatch = {
        playthroughId: this.playthroughId,
        idempotencyKey: batchKey(this.playthroughId, turn, events),
        events,
      };
      await this.deliver(batch);
    }
    await this.retryQueued();
  }

  /** Re-send everything parked in the offline queue, in order. */
  async retryQueued(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      let queue = loadQueue(this.storyId, this.storage);
      while (queue.length > 0) {
        const batch = queue[0] as EffectBatch;
        try {
          await this.post(this.storyId, batch);
          this.onDelivered?.();
        } catch (e) {
          if (e instanceof ApiRequestError) {
            // The server saw it and said no — retrying cannot help (F639 etc.).
          } else {
            break; // still offline — keep the queue intact
          }
        }
        queue = queue.slice(1);
        saveQueue(this.storyId, queue, this.storage);
      }
    } finally {
      this.sending = false;
    }
  }

  private enqueueOffline(batch: EffectBatch): void {
    const queue = loadQueue(this.storyId, this.storage);
    if (!queue.some((b) => b.idempotencyKey === batch.idempotencyKey)) {
      saveQueue(this.storyId, [...queue, batch], this.storage);
    }
  }

  private async deliver(batch: EffectBatch): Promise<void> {
    try {
      await this.post(this.storyId, batch);
      this.onDelivered?.();
    } catch (e) {
      if (e instanceof ApiRequestError) {
        // Rejected by the server (validation / journal opt-out): drop it —
        // an invalid batch will never become valid by retrying.
        return;
      }
      this.enqueueOffline(batch);
    }
  }
}
