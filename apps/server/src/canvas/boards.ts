/**
 * Kanban boards engine (F1551–F1553, F1556, F1557).
 *
 * Pure, dependency-free module that groups board items into columns by a field
 * or by tags, enforces WIP limits, and supports item moves. No DB or I/O.
 */

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface BoardItem {
  id: string;
  title: string;
  tags: string[];
  fields: Record<string, string>;
}

export interface BoardColumn {
  key: string;
  title: string;
  itemIds: string[];
  count: number;
}

export interface Board {
  groupBy: string;
  columns: BoardColumn[];
  wipExceeded: string[];
}

export interface BoardOptions {
  /** 'status' | 'tag' | any field name */
  groupBy: string;
  /** Explicit column order / which columns to show */
  columnOrder?: string[];
  /** Per-column-key WIP max */
  wipLimits?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNSET_KEY = '(unset)';

// ---------------------------------------------------------------------------
// buildBoard (F1551, F1552, F1556)
// ---------------------------------------------------------------------------

/**
 * Build a Kanban board from `items` according to `opts`.
 *
 * - `groupBy === 'tag'`: item appears in a column for EACH of its tags.
 * - Otherwise: item goes in the column whose key equals `item.fields[groupBy]`
 *   (missing/empty value → "(unset)" column).
 * - Columns ordered by `columnOrder` when provided (only those columns shown);
 *   else all derived columns alphabetically, "(unset)" last.
 * - `wipExceeded`: column keys whose item count exceeds `wipLimits[key]`.
 */
export function buildBoard(items: BoardItem[], opts: BoardOptions): Board {
  const { groupBy, columnOrder, wipLimits } = opts;

  // Bucket: columnKey -> itemId[]
  const buckets = new Map<string, string[]>();

  const ensureBucket = (key: string): string[] => {
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = [];
      buckets.set(key, bucket);
    }
    return bucket;
  };

  if (groupBy === 'tag') {
    for (const item of items) {
      for (const tag of item.tags) {
        ensureBucket(tag).push(item.id);
      }
    }
  } else {
    for (const item of items) {
      const raw = item.fields[groupBy];
      const key = raw !== undefined && raw !== '' ? raw : UNSET_KEY;
      ensureBucket(key).push(item.id);
    }
  }

  // Determine column order.
  let keys: string[];
  if (columnOrder !== undefined && columnOrder.length > 0) {
    // Only show explicitly listed columns, in that order.
    keys = columnOrder.filter((k) => buckets.has(k));
  } else {
    // All derived columns: alphabetical, "(unset)" last.
    const all = Array.from(buckets.keys());
    const hasUnset = all.includes(UNSET_KEY);
    const sorted = all.filter((k) => k !== UNSET_KEY).sort();
    if (hasUnset) sorted.push(UNSET_KEY);
    keys = sorted;
  }

  const columns: BoardColumn[] = keys.map((key) => {
    const itemIds = buckets.get(key) ?? [];
    return { key, title: key, itemIds, count: itemIds.length };
  });

  // WIP exceeded: columns whose count > wipLimits[key].
  const wipExceeded: string[] = [];
  if (wipLimits !== undefined) {
    for (const col of columns) {
      const limit = wipLimits[col.key];
      if (limit !== undefined && col.count > limit) {
        wipExceeded.push(col.key);
      }
    }
  }

  return { groupBy, columns, wipExceeded };
}

// ---------------------------------------------------------------------------
// moveItem (F1553)
// ---------------------------------------------------------------------------

/**
 * Return a NEW item with the move applied (pure — does not mutate input).
 *
 * - Field group: sets `fields[groupBy] = toColumnKey`, or deletes the field
 *   when `toColumnKey === "(unset)"`.
 * - Tag group: replaces tags so the item lands in `toColumnKey`.
 */
export function moveItem(item: BoardItem, toColumnKey: string, groupBy: string): BoardItem {
  if (groupBy === 'tag') {
    // Replace all tags with just the target tag so the item lands there.
    return { ...item, tags: [toColumnKey] };
  }

  // Field group.
  const newFields = { ...item.fields };
  if (toColumnKey === UNSET_KEY) {
    delete newFields[groupBy];
  } else {
    newFields[groupBy] = toColumnKey;
  }
  return { ...item, fields: newFields };
}

// ---------------------------------------------------------------------------
// BOARD_TEMPLATES (F1557)
// ---------------------------------------------------------------------------

export const BOARD_TEMPLATES: Record<string, BoardOptions> = {
  'writing-pipeline': {
    groupBy: 'status',
    columnOrder: ['Idea', 'Drafting', 'Revising', 'Done'],
  },
  'reading-list': {
    groupBy: 'status',
    columnOrder: ['To Read', 'Reading', 'Read'],
  },
};
