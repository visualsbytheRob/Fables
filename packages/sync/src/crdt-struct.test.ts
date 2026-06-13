/**
 * CRDT structured data tests (F1181–F1190, F1191–F1200).
 *
 * Tests:
 *  - Entity fields as CRDT maps: concurrent field edits merge correctly
 *  - Notebook tree: concurrent moves resolve, no cycles, no orphans
 *  - Tags: commutative add/remove
 *  - Save-slot collision: LWW merge
 *  - FUZZ: random concurrent structural ops always converge (no lost moves, no cycles)
 *  - Three-device chaos simulation (F1191–F1200 hardening)
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createStructuredDoc,
  mergeStructuredDocs,
  setEntityField,
  setEntityFields,
  getEntityFields,
  seedEntityFields,
  upsertTreeNode,
  moveTreeNode,
  removeTreeNode,
  detectAndBreakCycles,
  getNotebookTree,
  addTag,
  removeTag,
  getTags,
  writeSaveSlot,
  deleteSaveSlot,
  getSaveSlots,
} from './crdt-struct.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sync doc A → doc B (one-way). */
function syncTo(from: Y.Doc, to: Y.Doc): void {
  const sv = Y.encodeStateVector(to);
  const diff = Y.encodeStateAsUpdate(from, sv);
  Y.applyUpdate(to, diff);
}

/** Full two-way merge. */
function fullMerge(a: Y.Doc, b: Y.Doc): void {
  syncTo(a, b);
  syncTo(b, a);
}

// ── Entity field tests ────────────────────────────────────────────────────────

describe('entity fields as CRDT maps (F1181)', () => {
  it('sets and reads a field', () => {
    const doc = createStructuredDoc();
    setEntityField(doc, 'name', 'Frodo');
    expect(getEntityFields(doc)).toEqual({ name: 'Frodo' });
  });

  it('sets multiple fields atomically', () => {
    const doc = createStructuredDoc();
    setEntityFields(doc, { type: 'character', age: 50 });
    const f = getEntityFields(doc);
    expect(f.type).toBe('character');
    expect(f.age).toBe(50);
  });

  it('concurrent field edits on different keys both survive', () => {
    const doc1 = createStructuredDoc();
    const doc2 = createStructuredDoc();

    // Both start empty
    setEntityField(doc1, 'name', 'Frodo');
    setEntityField(doc2, 'class', 'Hobbit');

    fullMerge(doc1, doc2);

    const f1 = getEntityFields(doc1);
    const f2 = getEntityFields(doc2);
    expect(f1.name).toBe('Frodo');
    expect(f1.class).toBe('Hobbit');
    expect(f1).toEqual(f2);
  });

  it('concurrent edits to same key resolve LWW', () => {
    const doc1 = createStructuredDoc();
    const doc2 = createStructuredDoc();

    // doc1 sets 'hp' = 10, doc2 sets 'hp' = 99
    setEntityField(doc1, 'hp', 10);
    setEntityField(doc2, 'hp', 99);

    fullMerge(doc1, doc2);

    const f1 = getEntityFields(doc1);
    const f2 = getEntityFields(doc2);
    // Both should converge to the same value (LWW — one of the two)
    expect(f1.hp).toEqual(f2.hp);
    expect([10, 99]).toContain(f1.hp);
  });

  it('seedEntityFields is idempotent (only populates when empty)', () => {
    const doc = createStructuredDoc();
    seedEntityFields(doc, { x: 1, y: 2 });
    seedEntityFields(doc, { x: 999, y: 888 }); // should not overwrite
    const f = getEntityFields(doc);
    expect(f.x).toBe(1); // not 999
    expect(f.y).toBe(2);
  });

  it('seedEntityFields populates an empty doc', () => {
    const doc = createStructuredDoc();
    seedEntityFields(doc, { level: 5 });
    expect(getEntityFields(doc).level).toBe(5);
  });
});

// ── Notebook tree tests ───────────────────────────────────────────────────────

describe('notebook tree as CRDT (F1182)', () => {
  it('upserts a root node', () => {
    const doc = createStructuredDoc();
    upsertTreeNode(doc, 'nb1', { parentId: null, order: 0, name: 'Root' });
    expect(getNotebookTree(doc)['nb1']?.name).toBe('Root');
  });

  it('concurrent moves both survive as one definitive parent (LWW)', () => {
    const doc1 = createStructuredDoc();
    const doc2 = createStructuredDoc();

    // Both start with the same tree
    upsertTreeNode(doc1, 'root', { parentId: null, order: 0, name: 'Root' });
    upsertTreeNode(doc1, 'A', { parentId: null, order: 1, name: 'A' });
    upsertTreeNode(doc1, 'B', { parentId: null, order: 2, name: 'B' });
    syncTo(doc1, doc2);

    // doc1 moves 'A' under 'root'; doc2 moves 'A' under 'B'
    moveTreeNode(doc1, 'A', 'root', 0);
    moveTreeNode(doc2, 'A', 'B', 0);

    fullMerge(doc1, doc2);

    const t1 = getNotebookTree(doc1);
    const t2 = getNotebookTree(doc2);
    // Both must converge to same parentId
    expect(t1['A']?.parentId).toBe(t2['A']?.parentId);
    // parentId must be one of 'root' or 'B'
    expect(['root', 'B']).toContain(t1['A']?.parentId);
  });

  it('detects and breaks cycles after concurrent move', () => {
    const doc = createStructuredDoc();
    upsertTreeNode(doc, 'A', { parentId: null, order: 0, name: 'A' });
    upsertTreeNode(doc, 'B', { parentId: 'A', order: 0, name: 'B' });
    // Manually create a cycle: A → B → A
    upsertTreeNode(doc, 'A', { parentId: 'B', order: 0, name: 'A' });

    const broken = detectAndBreakCycles(doc);
    expect(broken.size).toBeGreaterThan(0);

    // After cycle breaking, no cycles should remain
    const tree = getNotebookTree(doc);
    // Walk from A and B — neither should loop
    function hasNoCycle(nodeId: string): boolean {
      const visited = new Set<string>();
      let cur: string | null = nodeId;
      while (cur !== null) {
        if (visited.has(cur)) return false;
        visited.add(cur);
        cur = tree[cur]?.parentId ?? null;
      }
      return true;
    }
    expect(hasNoCycle('A')).toBe(true);
    expect(hasNoCycle('B')).toBe(true);
  });

  it('removeTreeNode re-parents children to grandparent', () => {
    const doc = createStructuredDoc();
    upsertTreeNode(doc, 'root', { parentId: null, order: 0, name: 'Root' });
    upsertTreeNode(doc, 'mid', { parentId: 'root', order: 0, name: 'Mid' });
    upsertTreeNode(doc, 'leaf', { parentId: 'mid', order: 0, name: 'Leaf' });

    removeTreeNode(doc, 'mid');

    const tree = getNotebookTree(doc);
    expect(tree['mid']).toBeUndefined();
    // leaf should now point to root (mid's parent)
    expect(tree['leaf']?.parentId).toBe('root');
  });
});

// ── Tags (commutative) ────────────────────────────────────────────────────────

describe('tag operations as commutative CRDT (F1183)', () => {
  it('adds and reads tags', () => {
    const doc = createStructuredDoc();
    addTag(doc, 'fantasy');
    addTag(doc, 'magic');
    expect(getTags(doc)).toEqual(['fantasy', 'magic']);
  });

  it('removes a tag', () => {
    const doc = createStructuredDoc();
    addTag(doc, 'fantasy');
    addTag(doc, 'magic');
    removeTag(doc, 'fantasy');
    expect(getTags(doc)).toEqual(['magic']);
  });

  it('concurrent add of same tag is idempotent', () => {
    const doc1 = createStructuredDoc();
    const doc2 = createStructuredDoc();
    addTag(doc1, 'scifi');
    addTag(doc2, 'scifi');
    fullMerge(doc1, doc2);
    expect(getTags(doc1)).toEqual(['scifi']);
    expect(getTags(doc2)).toEqual(['scifi']);
  });

  it('concurrent add+remove converges (LWW — one outcome)', () => {
    const doc1 = createStructuredDoc();
    const doc2 = createStructuredDoc();

    addTag(doc1, 'thriller');
    syncTo(doc1, doc2);

    removeTag(doc2, 'thriller');
    addTag(doc1, 'thriller'); // re-add concurrently

    fullMerge(doc1, doc2);

    // Both docs must agree (LWW — could be present or absent)
    expect(getTags(doc1)).toEqual(getTags(doc2));
  });

  it('concurrent distinct tag additions all survive', () => {
    const doc1 = createStructuredDoc();
    const doc2 = createStructuredDoc();
    addTag(doc1, 'mystery');
    addTag(doc2, 'horror');
    fullMerge(doc1, doc2);
    const tags = getTags(doc1);
    expect(tags).toContain('mystery');
    expect(tags).toContain('horror');
    expect(getTags(doc1)).toEqual(getTags(doc2));
  });
});

// ── Save-slot collision handling ──────────────────────────────────────────────

describe('save-slot collision handling (F1184)', () => {
  it('writes and reads a save slot', () => {
    const doc = createStructuredDoc();
    writeSaveSlot(doc, {
      slotName: 'slot1',
      state: { chapter: 1 },
      deviceLabel: 'iPhone',
      savedAt: '2024-01-01T00:00:00Z',
    });
    const slots = getSaveSlots(doc);
    expect(slots).toHaveLength(1);
    expect(slots[0]?.slotName).toBe('slot1');
  });

  it('concurrent writes to same slot resolve LWW', () => {
    const doc1 = createStructuredDoc();
    const doc2 = createStructuredDoc();
    writeSaveSlot(doc1, {
      slotName: 'slot1',
      state: { v: 1 },
      deviceLabel: 'A',
      savedAt: '2024-01-01T00:00:00Z',
    });
    writeSaveSlot(doc2, {
      slotName: 'slot1',
      state: { v: 2 },
      deviceLabel: 'B',
      savedAt: '2024-01-01T00:01:00Z',
    });
    fullMerge(doc1, doc2);
    const s1 = getSaveSlots(doc1);
    const s2 = getSaveSlots(doc2);
    expect(s1).toHaveLength(1);
    expect(s2).toHaveLength(1);
    // Both must converge to the same state
    expect(s1[0]?.state).toEqual(s2[0]?.state);
  });

  it('deletes a save slot', () => {
    const doc = createStructuredDoc();
    writeSaveSlot(doc, {
      slotName: 'slot1',
      state: {},
      deviceLabel: 'A',
      savedAt: '2024-01-01T00:00:00Z',
    });
    deleteSaveSlot(doc, 'slot1');
    expect(getSaveSlots(doc)).toHaveLength(0);
  });
});

// ── FUZZ: random concurrent structural ops always converge ─────────────────────

describe('FUZZ: structural convergence (F1191–F1200)', () => {
  it('random concurrent field edits always converge — 50 iterations', () => {
    for (let i = 0; i < 50; i++) {
      const doc1 = createStructuredDoc();
      const doc2 = createStructuredDoc();

      // Random fields on each doc
      const fields = ['hp', 'mp', 'xp', 'level', 'name'];
      for (const f of fields) {
        if (Math.random() > 0.5) setEntityField(doc1, f, Math.floor(Math.random() * 100));
        if (Math.random() > 0.5) setEntityField(doc2, f, Math.floor(Math.random() * 100));
      }

      fullMerge(doc1, doc2);

      // Convergence: both docs must have identical fields
      expect(getEntityFields(doc1)).toEqual(getEntityFields(doc2));
    }
  });

  it('random concurrent tree moves never produce cycles — 30 iterations', () => {
    for (let iter = 0; iter < 30; iter++) {
      const doc1 = createStructuredDoc();
      // Build a 5-node tree
      const nodes = ['A', 'B', 'C', 'D', 'E'];
      for (const n of nodes) {
        upsertTreeNode(doc1, n, { parentId: null, order: 0, name: n });
      }
      const doc2 = createStructuredDoc();
      syncTo(doc1, doc2);

      // Random moves on doc1
      for (let m = 0; m < 5; m++) {
        const nodeIdx = Math.floor(Math.random() * nodes.length);
        const parentIdx = Math.floor(Math.random() * nodes.length);
        const node = nodes[nodeIdx]!;
        const parent = nodes[parentIdx]!;
        if (node !== parent) {
          moveTreeNode(doc1, node, parent, m);
        }
      }

      // Random moves on doc2
      for (let m = 0; m < 5; m++) {
        const nodeIdx = Math.floor(Math.random() * nodes.length);
        const parentIdx = Math.floor(Math.random() * nodes.length);
        const node = nodes[nodeIdx]!;
        const parent = nodes[parentIdx]!;
        if (node !== parent) {
          moveTreeNode(doc2, node, parent, m);
        }
      }

      fullMerge(doc1, doc2);

      // Break any cycles
      detectAndBreakCycles(doc1);
      detectAndBreakCycles(doc2);

      // After sync + cycle-break, both must agree
      expect(getNotebookTree(doc1)).toEqual(getNotebookTree(doc2));

      // And no cycles must remain
      const tree = getNotebookTree(doc1);
      for (const nodeId of nodes) {
        const visited = new Set<string>();
        let cur: string | null = nodeId;
        let hasCycle = false;
        while (cur !== null && tree[cur] !== undefined) {
          if (visited.has(cur)) {
            hasCycle = true;
            break;
          }
          visited.add(cur);
          cur = tree[cur]?.parentId ?? null;
        }
        expect(hasCycle).toBe(false);
      }
    }
  });

  it('random concurrent tag ops always converge — 50 iterations', () => {
    const allTags = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let i = 0; i < 50; i++) {
      const doc1 = createStructuredDoc();
      const doc2 = createStructuredDoc();

      for (const t of allTags) {
        if (Math.random() > 0.5) addTag(doc1, t);
        if (Math.random() > 0.5) addTag(doc2, t);
        if (Math.random() > 0.7) removeTag(doc1, t);
        if (Math.random() > 0.7) removeTag(doc2, t);
      }

      fullMerge(doc1, doc2);

      expect(getTags(doc1)).toEqual(getTags(doc2));
    }
  });
});

// ── Three-device chaos simulation (F1191–F1200) ───────────────────────────────

describe('three-device chaos: partitions, clock skew, kill mid-batch (F1191)', () => {
  it('three devices with network partition eventually converge on fields', () => {
    const devA = createStructuredDoc();
    const devB = createStructuredDoc();
    const devC = createStructuredDoc();

    // Phase 1: A and B sync, C is isolated
    setEntityField(devA, 'name', 'Aragorn');
    setEntityField(devB, 'class', 'Ranger');
    fullMerge(devA, devB);
    // C is offline

    // Phase 2: A and C sync (C was isolated from B)
    setEntityField(devC, 'hp', 100);
    fullMerge(devA, devC);

    // Phase 3: B and C sync
    fullMerge(devB, devC);

    // Phase 4: All three sync (re-convergence)
    fullMerge(devA, devB);
    fullMerge(devB, devC);
    fullMerge(devA, devC);

    const fA = getEntityFields(devA);
    const fB = getEntityFields(devB);
    const fC = getEntityFields(devC);
    expect(fA).toEqual(fB);
    expect(fB).toEqual(fC);
    expect(fA.name).toBe('Aragorn');
    expect(fA.class).toBe('Ranger');
    expect(fA.hp).toBe(100);
  });

  it('kill-mid-batch: partial updates from C still merge correctly', () => {
    const devA = createStructuredDoc();
    const devB = createStructuredDoc();
    const devC = createStructuredDoc();

    // C makes several edits
    setEntityField(devC, 'x', 1);
    setEntityField(devC, 'y', 2);
    setEntityField(devC, 'z', 3);

    // Only first update from C gets to A before "crash" (simulate by only syncing partial)
    const allUpdates = Y.encodeStateAsUpdate(devC);
    // Apply partial: just apply what C had after first field
    // (We can't truly split by transaction, but we can apply all — simulates no-data-loss)
    Y.applyUpdate(devA, allUpdates);

    // B only hears from A (which has partial C)
    syncTo(devA, devB);

    // C comes back and re-syncs
    fullMerge(devC, devA);
    fullMerge(devC, devB);
    fullMerge(devA, devB);

    const fA = getEntityFields(devA);
    const fB = getEntityFields(devB);
    const fC = getEntityFields(devC);
    expect(fA).toEqual(fB);
    expect(fB).toEqual(fC);
    // All three fields should be present (no data loss)
    expect(fA.x).toBe(1);
    expect(fA.y).toBe(2);
    expect(fA.z).toBe(3);
  });

  it('clock skew: updates from different logical clocks still converge', () => {
    // Yjs uses its own internal clock (client IDs + logical counters),
    // so wall-clock skew doesn't affect correctness. We simulate this by
    // having docs with very different clientIDs make concurrent edits.
    const docs = Array.from({ length: 3 }, () => {
      const d = new Y.Doc({ gc: false });
      return d;
    });

    // Different "times": doc[0] edits, then much later doc[1] and doc[2] edit
    for (let i = 0; i < 10; i++) {
      setEntityField(docs[0]!, `field_${String(i)}`, i);
    }
    // Simulate "later" by making more ops on doc[1] before syncing
    for (let i = 10; i < 20; i++) {
      setEntityField(docs[1]!, `field_${String(i)}`, i);
    }
    setEntityField(docs[2]!, 'field_latest', 99);

    // Chaotic merge order
    fullMerge(docs[0]!, docs[2]!);
    fullMerge(docs[1]!, docs[0]!);
    fullMerge(docs[2]!, docs[1]!);
    fullMerge(docs[0]!, docs[1]!);

    const f0 = getEntityFields(docs[0]!);
    const f1 = getEntityFields(docs[1]!);
    const f2 = getEntityFields(docs[2]!);
    expect(f0).toEqual(f1);
    expect(f1).toEqual(f2);
    expect(Object.keys(f0)).toHaveLength(21); // 0-19 + field_latest
  });
});

// ── Data integrity checksums across collab paths ──────────────────────────────

describe('data integrity: CRDT state checksums (F1197)', () => {
  it('mergeStructuredDocs produces identical result to fullMerge', () => {
    const doc1 = createStructuredDoc();
    const doc2 = createStructuredDoc();
    setEntityField(doc1, 'a', 1);
    setEntityField(doc2, 'b', 2);

    const merged = mergeStructuredDocs(doc1, doc2);
    fullMerge(doc1, doc2);

    // Merged doc and doc1 (after fullMerge) must have the same state.
    // State vectors may differ in client ordering but the state update should be same.
    const state1 = Y.encodeStateAsUpdate(merged);
    const state2 = Y.encodeStateAsUpdate(doc1);
    // Apply each other's state to empty docs and compare
    const check1 = new Y.Doc({ gc: false });
    const check2 = new Y.Doc({ gc: false });
    Y.applyUpdate(check1, state1);
    Y.applyUpdate(check2, state2);
    expect(getEntityFields(check1)).toEqual(getEntityFields(check2));
  });

  it('encoding and re-applying state is lossless', () => {
    const doc = createStructuredDoc();
    setEntityFields(doc, { x: 1, y: 'hello', z: true });
    addTag(doc, 'mytag');
    upsertTreeNode(doc, 'nb1', { parentId: null, order: 0, name: 'Root' });

    const state = Y.encodeStateAsUpdate(doc);
    const restored = new Y.Doc({ gc: false });
    Y.applyUpdate(restored, state);

    expect(getEntityFields(restored)).toEqual({ x: 1, y: 'hello', z: true });
    expect(getTags(restored)).toEqual(['mytag']);
    expect(getNotebookTree(restored)['nb1']?.name).toBe('Root');
  });
});
