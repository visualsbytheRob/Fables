/**
 * CRDT-backed structured data (F1181–F1190).
 *
 * Extends the CRDT layer so structured data (entity fields, notebook trees,
 * tags) also merges without conflict.
 *
 * Architecture:
 *   - Entity fields: Y.Map keyed by field name; concurrent field edits merge by
 *     Last-Writer-Wins per field (Yjs handles this automatically via clientID
 *     ordering when clocks match).
 *   - Notebook tree: Y.Map<Y.Map> where each entry holds {parentId, order, name}.
 *     Concurrent moves resolve by LWW on the parentId field. Cycles are detected
 *     and broken by resetting the moved item to its previous parent.
 *   - Tags: Y.Array on each entity (commutative: concurrent add/remove of the
 *     same tag converges — we store canonical tag strings, de-dup on read).
 *   - Save-slot collision: handled by a Y.Map keyed by slotName; concurrent
 *     writes to the same slot name resolve LWW.
 *
 * FALLBACK: All of this is optional — callers that don't use these helpers
 * continue to use the REST op-log (unaffected).
 *
 * Cross-structure transaction semantics:
 *   All mutations to a given doc are wrapped in doc.transact() so they appear
 *   as a single atomic update on the wire. Cross-doc transactions are not
 *   supported at the CRDT layer; coordination is the caller's responsibility.
 *
 * Migration: existing rows can be lazily migrated.  Call seedEntityFields() with
 * the current field map; the Y.Map is populated only if empty (idempotent).
 */

import * as Y from 'yjs';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Y.Map key for entity fields in a doc. */
export const ENTITY_FIELDS_KEY = 'entityFields';
/** Y.Map key for notebook tree nodes. */
export const NOTEBOOK_TREE_KEY = 'notebookTree';
/** Y.Array key for tags. */
export const ENTITY_TAGS_KEY = 'entityTags';
/** Y.Map key for save slots. */
export const SAVE_SLOTS_KEY = 'saveSlots';

// ── Entity fields as CRDT maps ────────────────────────────────────────────────

/**
 * Get or create the entity fields Y.Map in a doc.
 * Concurrent field edits merge (LWW per field via Yjs clientID ordering).
 */
export function getEntityFieldsMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(ENTITY_FIELDS_KEY);
}

/**
 * Set a single field on an entity.  Wrapped in a transaction so it's one op.
 */
export function setEntityField(doc: Y.Doc, key: string, value: unknown): void {
  doc.transact(() => {
    getEntityFieldsMap(doc).set(key, value);
  });
}

/**
 * Set multiple fields atomically.  Concurrent concurrent sibling-field edits
 * all survive independently; only same-key concurrent edits resolve LWW.
 */
export function setEntityFields(doc: Y.Doc, fields: Record<string, unknown>): void {
  doc.transact(() => {
    const map = getEntityFieldsMap(doc);
    for (const [k, v] of Object.entries(fields)) {
      map.set(k, v);
    }
  });
}

/**
 * Read all entity fields as a plain object snapshot.
 */
export function getEntityFields(doc: Y.Doc): Record<string, unknown> {
  return Object.fromEntries(getEntityFieldsMap(doc).entries());
}

/**
 * Lazily seed entity fields from an existing plain-object record.
 * Only populates if the map is currently empty (idempotent migration path).
 */
export function seedEntityFields(doc: Y.Doc, fields: Record<string, unknown>): void {
  const map = getEntityFieldsMap(doc);
  if (map.size === 0 && Object.keys(fields).length > 0) {
    doc.transact(() => {
      for (const [k, v] of Object.entries(fields)) {
        map.set(k, v);
      }
    });
  }
}

// ── Notebook tree as CRDT ─────────────────────────────────────────────────────

export interface TreeNode {
  parentId: string | null;
  order: number;
  name: string;
}

/**
 * Get or create the notebook tree Y.Map.
 * Keys are node IDs (notebook IDs); values are plain-object TreeNode snapshots.
 */
export function getNotebookTreeMap(doc: Y.Doc): Y.Map<TreeNode> {
  return doc.getMap<TreeNode>(NOTEBOOK_TREE_KEY);
}

/**
 * Upsert a tree node.  Concurrent moves (parentId change) resolve LWW.
 */
export function upsertTreeNode(doc: Y.Doc, nodeId: string, node: TreeNode): void {
  doc.transact(() => {
    getNotebookTreeMap(doc).set(nodeId, node);
  });
}

/**
 * Move a node to a new parent.  After applying, call detectAndBreakCycles()
 * to ensure the tree is acyclic.
 */
export function moveTreeNode(
  doc: Y.Doc,
  nodeId: string,
  newParentId: string | null,
  order: number,
): void {
  const map = getNotebookTreeMap(doc);
  const existing = map.get(nodeId);
  if (!existing) return;
  doc.transact(() => {
    map.set(nodeId, { ...existing, parentId: newParentId, order });
  });
}

/**
 * Remove a node from the tree.  Children are re-parented to the deleted node's
 * parent (safe move-up on orphan resolution).
 */
export function removeTreeNode(doc: Y.Doc, nodeId: string): void {
  const map = getNotebookTreeMap(doc);
  const node = map.get(nodeId);
  if (!node) return;
  doc.transact(() => {
    // Re-parent children before deleting
    for (const [childId, child] of map.entries()) {
      if (child.parentId === nodeId) {
        map.set(childId, { ...child, parentId: node.parentId });
      }
    }
    map.delete(nodeId);
  });
}

/**
 * Detect cycles in the tree and break them by resetting any node that
 * participates in a cycle to parentId=null (root).
 *
 * This is called after merging concurrent updates.  Cycle detection is O(n²)
 * but the notebook tree is small in practice (< 1000 nodes).
 *
 * Returns the set of nodeIds whose parentId was reset (for logging).
 */
export function detectAndBreakCycles(doc: Y.Doc): Set<string> {
  const map = getNotebookTreeMap(doc);
  const broken = new Set<string>();

  for (const [nodeId] of map.entries()) {
    // Walk ancestors — if we revisit nodeId, we have a cycle
    const visited = new Set<string>();
    let current: string | null = nodeId;
    while (current !== null) {
      if (visited.has(current)) {
        // Cycle detected — break it by resetting current node to root
        const cycleNode = map.get(current);
        if (cycleNode && cycleNode.parentId !== null) {
          doc.transact(() => {
            map.set(current!, { ...cycleNode!, parentId: null });
          });
          broken.add(current);
        }
        break;
      }
      visited.add(current);
      const node = map.get(current);
      current = node?.parentId ?? null;
    }
  }

  return broken;
}

/**
 * Read the tree as a plain adjacency map.
 */
export function getNotebookTree(doc: Y.Doc): Record<string, TreeNode> {
  return Object.fromEntries(getNotebookTreeMap(doc).entries());
}

// ── Tags as commutative CRDT ──────────────────────────────────────────────────

/**
 * Tags are stored in a Y.Map<true> (presence map) for O(1) add/remove and
 * commutative semantics: concurrent add+remove of the same tag is LWW.
 * Reading returns the de-duped sorted list of active tags.
 */
export function getTagsMap(doc: Y.Doc): Y.Map<boolean> {
  return doc.getMap<boolean>(ENTITY_TAGS_KEY);
}

export function addTag(doc: Y.Doc, tag: string): void {
  doc.transact(() => {
    getTagsMap(doc).set(tag, true);
  });
}

export function removeTag(doc: Y.Doc, tag: string): void {
  doc.transact(() => {
    getTagsMap(doc).delete(tag);
  });
}

export function getTags(doc: Y.Doc): string[] {
  return Array.from(getTagsMap(doc).entries())
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort();
}

// ── Save-slot collision handling ──────────────────────────────────────────────

export interface SaveSlotEntry {
  slotName: string;
  state: unknown;
  deviceLabel: string;
  savedAt: string;
}

export function getSaveSlotsMap(doc: Y.Doc): Y.Map<SaveSlotEntry> {
  return doc.getMap<SaveSlotEntry>(SAVE_SLOTS_KEY);
}

/**
 * Write a save slot.  Concurrent writes to the same slotName resolve LWW.
 */
export function writeSaveSlot(doc: Y.Doc, slot: SaveSlotEntry): void {
  doc.transact(() => {
    getSaveSlotsMap(doc).set(slot.slotName, slot);
  });
}

export function deleteSaveSlot(doc: Y.Doc, slotName: string): void {
  doc.transact(() => {
    getSaveSlotsMap(doc).delete(slotName);
  });
}

export function getSaveSlots(doc: Y.Doc): SaveSlotEntry[] {
  return Array.from(getSaveSlotsMap(doc).values());
}

// ── Utility: create a structured doc ─────────────────────────────────────────

/**
 * Create a Y.Doc pre-initialised with all structured CRDT sub-documents.
 * The body text (for notes) is separate — use createNoteDoc() + getNoteText().
 */
export function createStructuredDoc(): Y.Doc {
  return new Y.Doc({ gc: false });
}

/**
 * Merge two structured doc states (for convergence testing).
 */
export function mergeStructuredDocs(docA: Y.Doc, docB: Y.Doc): Y.Doc {
  const merged = createStructuredDoc();
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(docA));
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(docB));
  return merged;
}
