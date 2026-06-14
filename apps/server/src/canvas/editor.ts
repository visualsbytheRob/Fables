/**
 * In-memory canvas editor with undo/redo (F1506 multi-select/group/lock, F1507 undo).
 *
 * Pure state + an inverse-recording command stack: every mutating operation
 * captures how to undo itself before it runs, so undo/redo are exact and
 * unlimited. The web canvas drives this; persistence (the repo) snapshots the
 * resulting object set. Kept free of I/O so the whole interaction model is
 * unit-testable.
 */

import type { CanvasObject } from './types.js';

interface Op {
  redo: () => void;
  undo: () => void;
}

export class CanvasEditor {
  private readonly objects = new Map<string, CanvasObject>();
  private readonly undoStack: Op[] = [];
  private readonly redoStack: Op[] = [];

  constructor(initial: CanvasObject[] = []) {
    for (const o of initial) this.objects.set(o.id, { ...o });
  }

  list(): CanvasObject[] {
    return [...this.objects.values()].sort((a, b) => a.z - b.z);
  }
  get(id: string): CanvasObject | undefined {
    const o = this.objects.get(id);
    return o ? { ...o } : undefined;
  }
  get size(): number {
    return this.objects.size;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private run(op: Op): void {
    op.redo();
    this.undoStack.push(op);
    this.redoStack.length = 0; // a fresh action clears the redo branch
  }

  undo(): void {
    const op = this.undoStack.pop();
    if (!op) return;
    op.undo();
    this.redoStack.push(op);
  }

  redo(): void {
    const op = this.redoStack.pop();
    if (!op) return;
    op.redo();
    this.undoStack.push(op);
  }

  // ── Operations ─────────────────────────────────────────────────────────────

  add(object: CanvasObject): void {
    const copy = { ...object };
    this.run({
      redo: () => this.objects.set(copy.id, { ...copy }),
      undo: () => this.objects.delete(copy.id),
    });
  }

  remove(ids: string[]): void {
    const removed = ids
      .map((id) => this.objects.get(id))
      .filter((o): o is CanvasObject => o !== undefined)
      .map((o) => ({ ...o }));
    this.run({
      redo: () => removed.forEach((o) => this.objects.delete(o.id)),
      undo: () => removed.forEach((o) => this.objects.set(o.id, { ...o })),
    });
  }

  /** Translate a selection by (dx, dy), skipping locked objects (F1506). */
  move(ids: string[], dx: number, dy: number): void {
    const targets = ids
      .map((id) => this.objects.get(id))
      .filter((o): o is CanvasObject => o !== undefined && !o.locked)
      .map((o) => o.id);
    this.run({
      redo: () => this.shift(targets, dx, dy),
      undo: () => this.shift(targets, -dx, -dy),
    });
  }

  private shift(ids: string[], dx: number, dy: number): void {
    for (const id of ids) {
      const o = this.objects.get(id);
      if (o) {
        o.x += dx;
        o.y += dy;
      }
    }
  }

  /** Group a selection under a new group id (F1506). */
  group(ids: string[], groupId: string): void {
    const prev = new Map<string, string | null>();
    for (const id of ids) {
      const o = this.objects.get(id);
      if (o) prev.set(id, o.groupId);
    }
    this.run({
      redo: () => prev.forEach((_v, id) => this.setField(id, 'groupId', groupId)),
      undo: () => prev.forEach((v, id) => this.setField(id, 'groupId', v)),
    });
  }

  ungroup(ids: string[]): void {
    const prev = new Map<string, string | null>();
    for (const id of ids) {
      const o = this.objects.get(id);
      if (o) prev.set(id, o.groupId);
    }
    this.run({
      redo: () => prev.forEach((_v, id) => this.setField(id, 'groupId', null)),
      undo: () => prev.forEach((v, id) => this.setField(id, 'groupId', v)),
    });
  }

  /** Lock or unlock a selection (F1506). */
  setLocked(ids: string[], locked: boolean): void {
    const prev = new Map<string, boolean>();
    for (const id of ids) {
      const o = this.objects.get(id);
      if (o) prev.set(id, o.locked);
    }
    this.run({
      redo: () => prev.forEach((_v, id) => this.setField(id, 'locked', locked)),
      undo: () => prev.forEach((v, id) => this.setField(id, 'locked', v)),
    });
  }

  /** Raise a selection above everything else, preserving relative order. */
  bringToFront(ids: string[]): void {
    const prevZ = new Map<string, number>();
    for (const id of ids) {
      const o = this.objects.get(id);
      if (o) prevZ.set(id, o.z);
    }
    const maxZ = Math.max(0, ...[...this.objects.values()].map((o) => o.z));
    const ordered = [...prevZ.keys()].sort((a, b) => (prevZ.get(a) ?? 0) - (prevZ.get(b) ?? 0));
    this.run({
      redo: () => ordered.forEach((id, i) => this.setField(id, 'z', maxZ + 1 + i)),
      undo: () => prevZ.forEach((z, id) => this.setField(id, 'z', z)),
    });
  }

  private setField<K extends keyof CanvasObject>(id: string, key: K, value: CanvasObject[K]): void {
    const o = this.objects.get(id);
    if (o) o[key] = value;
  }
}
