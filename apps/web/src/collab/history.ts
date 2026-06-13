/**
 * Merge & history (F1171–F1180): named checkpoints, attribution, and time-slider.
 *
 * F1171 — named checkpoints (manual snapshots via Y.Doc state)
 * F1172 — attribution view (per-character authorship from CRDT, color-coded)
 * F1173 — time-slider playback of document history
 * F1174 — restore checkpoint (with confirmation)
 * F1175 — diff view between checkpoints
 * F1176 — forensic recovery affordance
 *
 * Checkpoint storage: a Y.Array of CheckpointMeta on the shared doc.
 * The actual state snapshot is stored as a base64-encoded Y.Doc update.
 */

import * as Y from 'yjs';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CheckpointMeta {
  id: string;
  name: string;
  ts: number;
  /** base64-encoded Y.encodeStateAsUpdate result */
  snapshotB64: string;
  /** clientId of the author */
  authorId: number;
  authorName: string;
}

export interface AttributionSegment {
  text: string;
  authorId: number;
  authorName: string;
  color: string;
}

export interface DiffOp {
  op: 'equal' | 'add' | 'del';
  text: string;
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function encodeSnapshot(update: Uint8Array): string {
  return btoa(String.fromCharCode(...update));
}

function decodeSnapshot(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ─── HistoryStore ─────────────────────────────────────────────────────────────

export class HistoryStore {
  private _checkpoints: Y.Array<CheckpointMeta>;
  private _listeners: Array<() => void> = [];

  constructor(yDoc: Y.Doc) {
    this._checkpoints = yDoc.getArray('history.checkpoints');
    this._checkpoints.observe(() => this._notify());
  }

  subscribe(fn: () => void): () => void {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== fn);
    };
  }

  private _notify() {
    this._listeners.forEach((fn) => fn());
  }

  // ─── Checkpoints (F1171) ──────────────────────────────────────────────────

  listCheckpoints(): CheckpointMeta[] {
    return this._checkpoints.toArray().slice().reverse();
  }

  /** Create a named snapshot of the current Y.Doc state. */
  createCheckpoint(
    yDoc: Y.Doc,
    name: string,
    authorId: number,
    authorName: string,
  ): CheckpointMeta {
    const update = Y.encodeStateAsUpdate(yDoc);
    const meta: CheckpointMeta = {
      id: `cp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      ts: Date.now(),
      snapshotB64: encodeSnapshot(update),
      authorId,
      authorName,
    };
    this._checkpoints.push([meta]);
    return meta;
  }

  deleteCheckpoint(id: string) {
    const idx = this._checkpoints.toArray().findIndex((cp) => cp.id === id);
    if (idx !== -1) this._checkpoints.delete(idx, 1);
  }

  getCheckpoint(id: string): CheckpointMeta | null {
    return this._checkpoints.toArray().find((cp) => cp.id === id) ?? null;
  }

  // ─── Restore (F1174) ─────────────────────────────────────────────────────

  /**
   * Returns the text content from a checkpoint snapshot.
   * The caller can then apply it back to the live Y.Doc after confirmation.
   */
  snapshotText(checkpoint: CheckpointMeta): string {
    const update = decodeSnapshot(checkpoint.snapshotB64);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    const text = doc.getText('body').toString();
    doc.destroy();
    return text;
  }

  /**
   * Restore a checkpoint by applying its snapshot to targetDoc.
   * This overwrites the current content — MUST be called after user confirmation.
   */
  restoreCheckpoint(checkpoint: CheckpointMeta, targetDoc: Y.Doc) {
    const update = decodeSnapshot(checkpoint.snapshotB64);
    Y.applyUpdate(targetDoc, update);
  }

  // ─── Diff (F1175) ─────────────────────────────────────────────────────────

  diff(oldText: string, newText: string): DiffOp[] {
    if (oldText === newText) {
      return [{ op: 'equal', text: oldText }];
    }
    // Split into lines for readability
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const result = lineDiff(oldLines, newLines);
    return result;
  }

  /**
   * Diff between two checkpoints (or between a checkpoint and current state).
   */
  diffCheckpoints(
    fromCp: CheckpointMeta,
    toCp: CheckpointMeta | null,
    currentDoc: Y.Doc,
  ): DiffOp[] {
    const fromText = this.snapshotText(fromCp);
    const toText = toCp ? this.snapshotText(toCp) : currentDoc.getText('body').toString();
    return this.diff(fromText, toText);
  }

  // ─── Attribution (F1172) ──────────────────────────────────────────────────

  /**
   * Build attribution segments from a Y.Text.
   *
   * Y.js stores authorship via client IDs on each insert item.
   * We walk the Y.Text's internal linked list (Y.AbstractType._start)
   * to extract per-character client ID attribution.
   *
   * userColors: clientId → {name, color}
   */
  buildAttribution(
    yText: Y.Text,
    userColors: Map<number, { name: string; color: string }>,
  ): AttributionSegment[] {
    const segments: AttributionSegment[] = [];

    // Walk internal Y.js items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let item = (yText as any)._start as any;
    while (item !== null) {
      if (!item.deleted && item.content && item.content.str !== undefined) {
        const clientId = item.id?.client ?? 0;
        const user = userColors.get(clientId) ?? { name: `Client ${clientId}`, color: '#888' };
        const last = segments[segments.length - 1];
        if (last && last.authorId === clientId) {
          // Merge adjacent segments from same author
          last.text += item.content.str as string;
        } else {
          segments.push({
            text: item.content.str as string,
            authorId: clientId,
            authorName: user.name,
            color: user.color,
          });
        }
      }
      item = item.right;
    }

    return segments;
  }

  // ─── Time-slider (F1173) ─────────────────────────────────────────────────

  /**
   * Returns the text at a given checkpoint index (0 = oldest).
   * Used by the time-slider to show historical states.
   */
  getTextAtCheckpointIndex(index: number): string | null {
    const all = this._checkpoints.toArray();
    if (index < 0 || index >= all.length) return null;
    const cp = all[index];
    if (!cp) return null;
    return this.snapshotText(cp);
  }

  // ─── Forensic recovery (F1176) ───────────────────────────────────────────

  /**
   * Returns all checkpoint snapshots as a JSON-serialisable array
   * for out-of-band recovery (e.g. copy to clipboard, download).
   */
  exportForRecovery(): string {
    const data = {
      exportedAt: new Date().toISOString(),
      checkpoints: this._checkpoints.toArray(),
    };
    return JSON.stringify(data, null, 2);
  }

  destroy() {
    this._listeners = [];
  }
}

// ─── Simple line-level LCS diff ──────────────────────────────────────────────

function lineDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  // Myers-style diff via table — bounded to 2000 lines for performance
  const maxLines = 2000;
  const a = oldLines.slice(0, maxLines);
  const b = newLines.slice(0, maxLines);
  const n = a.length;
  const m = b.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i]![j] = (dp[i + 1]![j + 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ op: 'equal', text: a[i]! });
      i++;
      j++;
    } else if (j < m && (i >= n || (dp[i]![j + 1] ?? 0) >= (dp[i + 1]![j] ?? 0))) {
      ops.push({ op: 'add', text: b[j]! });
      j++;
    } else {
      ops.push({ op: 'del', text: a[i]! });
      i++;
    }
  }
  return ops;
}
