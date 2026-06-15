import { describe, it, expect } from 'vitest';
import {
  buildBoard,
  moveItem,
  BOARD_TEMPLATES,
  type BoardItem,
  type BoardOptions,
} from './boards.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(id: string, overrides: Partial<BoardItem> = {}): BoardItem {
  return {
    id,
    title: id,
    tags: [],
    fields: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Field grouping (F1551)
// ---------------------------------------------------------------------------

describe('buildBoard — field grouping', () => {
  it('groups items by a field value into correct columns with correct counts', () => {
    const items: BoardItem[] = [
      makeItem('i1', { fields: { status: 'Idea' } }),
      makeItem('i2', { fields: { status: 'Done' } }),
      makeItem('i3', { fields: { status: 'Idea' } }),
    ];
    const opts: BoardOptions = { groupBy: 'status' };
    const board = buildBoard(items, opts);

    const ideaCol = board.columns.find((c) => c.key === 'Idea');
    const doneCol = board.columns.find((c) => c.key === 'Done');

    expect(ideaCol).toBeDefined();
    expect(ideaCol!.count).toBe(2);
    expect(ideaCol!.itemIds).toContain('i1');
    expect(ideaCol!.itemIds).toContain('i3');

    expect(doneCol).toBeDefined();
    expect(doneCol!.count).toBe(1);
    expect(doneCol!.itemIds).toContain('i2');
  });

  it('places items with missing field into "(unset)" column, sorted last', () => {
    const items: BoardItem[] = [
      makeItem('i1', { fields: { status: 'Idea' } }),
      makeItem('i2'), // no status field
      makeItem('i3', { fields: { status: '' } }), // empty → unset
    ];
    const board = buildBoard(items, { groupBy: 'status' });

    const keys = board.columns.map((c) => c.key);
    expect(keys[keys.length - 1]).toBe('(unset)');

    const unsetCol = board.columns.find((c) => c.key === '(unset)');
    expect(unsetCol).toBeDefined();
    expect(unsetCol!.count).toBe(2);
    expect(unsetCol!.itemIds).toContain('i2');
    expect(unsetCol!.itemIds).toContain('i3');
  });

  it('sorts columns alphabetically when no columnOrder is given', () => {
    const items: BoardItem[] = [
      makeItem('i1', { fields: { status: 'Zebra' } }),
      makeItem('i2', { fields: { status: 'Apple' } }),
      makeItem('i3', { fields: { status: 'Mango' } }),
    ];
    const board = buildBoard(items, { groupBy: 'status' });
    const keys = board.columns.map((c) => c.key);
    expect(keys).toEqual(['Apple', 'Mango', 'Zebra']);
  });
});

// ---------------------------------------------------------------------------
// columnOrder (F1552)
// ---------------------------------------------------------------------------

describe('buildBoard — columnOrder', () => {
  it('respects explicit columnOrder', () => {
    const items: BoardItem[] = [
      makeItem('i1', { fields: { status: 'Done' } }),
      makeItem('i2', { fields: { status: 'Idea' } }),
      makeItem('i3', { fields: { status: 'Drafting' } }),
    ];
    const opts: BoardOptions = {
      groupBy: 'status',
      columnOrder: ['Idea', 'Drafting', 'Done'],
    };
    const board = buildBoard(items, opts);
    expect(board.columns.map((c) => c.key)).toEqual(['Idea', 'Drafting', 'Done']);
  });

  it('shows only listed columns when columnOrder is provided', () => {
    const items: BoardItem[] = [
      makeItem('i1', { fields: { status: 'Done' } }),
      makeItem('i2', { fields: { status: 'Idea' } }),
      makeItem('i3', { fields: { status: 'Secret' } }), // not in order
    ];
    const opts: BoardOptions = {
      groupBy: 'status',
      columnOrder: ['Idea', 'Done'],
    };
    const board = buildBoard(items, opts);
    const keys = board.columns.map((c) => c.key);
    expect(keys).toEqual(['Idea', 'Done']);
    expect(keys).not.toContain('Secret');
  });
});

// ---------------------------------------------------------------------------
// Tag grouping (F1551)
// ---------------------------------------------------------------------------

describe('buildBoard — tag grouping', () => {
  it('places an item with multiple tags into each tag column', () => {
    const items: BoardItem[] = [
      makeItem('i1', { tags: ['a', 'b'] }),
      makeItem('i2', { tags: ['b'] }),
    ];
    const board = buildBoard(items, { groupBy: 'tag' });

    const colA = board.columns.find((c) => c.key === 'a');
    const colB = board.columns.find((c) => c.key === 'b');

    expect(colA).toBeDefined();
    expect(colA!.itemIds).toEqual(['i1']);
    expect(colA!.count).toBe(1);

    expect(colB).toBeDefined();
    expect(colB!.itemIds).toContain('i1');
    expect(colB!.itemIds).toContain('i2');
    expect(colB!.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// WIP limits (F1556)
// ---------------------------------------------------------------------------

describe('buildBoard — WIP limits', () => {
  it('adds exceeded columns to wipExceeded', () => {
    const items: BoardItem[] = [
      makeItem('i1', { fields: { status: 'Done' } }),
      makeItem('i2', { fields: { status: 'Done' } }),
      makeItem('i3', { fields: { status: 'Idea' } }),
    ];
    const opts: BoardOptions = {
      groupBy: 'status',
      wipLimits: { Done: 1 },
    };
    const board = buildBoard(items, opts);
    expect(board.wipExceeded).toContain('Done');
    expect(board.wipExceeded).not.toContain('Idea');
  });

  it('does not flag a column at exactly the limit', () => {
    const items: BoardItem[] = [makeItem('i1', { fields: { status: 'Done' } })];
    const board = buildBoard(items, {
      groupBy: 'status',
      wipLimits: { Done: 1 },
    });
    expect(board.wipExceeded).not.toContain('Done');
  });

  it('returns empty wipExceeded when no limits are set', () => {
    const items: BoardItem[] = [makeItem('i1', { fields: { status: 'Done' } })];
    const board = buildBoard(items, { groupBy: 'status' });
    expect(board.wipExceeded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// moveItem (F1553)
// ---------------------------------------------------------------------------

describe('moveItem', () => {
  it('sets fields[groupBy] to the target column key', () => {
    const item = makeItem('i1', { fields: { status: 'Idea' } });
    const moved = moveItem(item, 'Done', 'status');
    expect(moved.fields['status']).toBe('Done');
  });

  it('does not mutate the original item', () => {
    const item = makeItem('i1', { fields: { status: 'Idea' } });
    moveItem(item, 'Done', 'status');
    expect(item.fields['status']).toBe('Idea');
  });

  it('deletes the field when moving to "(unset)"', () => {
    const item = makeItem('i1', { fields: { status: 'Idea' } });
    const moved = moveItem(item, '(unset)', 'status');
    expect('status' in moved.fields).toBe(false);
  });

  it('rebuilding board after move places item in new column', () => {
    const item = makeItem('i1', { fields: { status: 'Idea' } });
    const moved = moveItem(item, 'Done', 'status');
    const board = buildBoard([moved], { groupBy: 'status' });
    const doneCol = board.columns.find((c) => c.key === 'Done');
    expect(doneCol).toBeDefined();
    expect(doneCol!.itemIds).toContain('i1');
  });

  it('replaces tags when groupBy is "tag"', () => {
    const item = makeItem('i1', { tags: ['a', 'b'] });
    const moved = moveItem(item, 'c', 'tag');
    expect(moved.tags).toEqual(['c']);
    // original untouched
    expect(item.tags).toEqual(['a', 'b']);
  });

  it('item lands in target column after tag move', () => {
    const item = makeItem('i1', { tags: ['a'] });
    const moved = moveItem(item, 'b', 'tag');
    const board = buildBoard([moved], { groupBy: 'tag' });
    const colB = board.columns.find((c) => c.key === 'b');
    expect(colB).toBeDefined();
    expect(colB!.itemIds).toContain('i1');
  });
});

// ---------------------------------------------------------------------------
// BOARD_TEMPLATES (F1557)
// ---------------------------------------------------------------------------

describe('BOARD_TEMPLATES', () => {
  it('has a "writing-pipeline" template with correct columnOrder', () => {
    const t = BOARD_TEMPLATES['writing-pipeline'];
    expect(t).toBeDefined();
    expect(t!.groupBy).toBe('status');
    expect(t!.columnOrder).toEqual(['Idea', 'Drafting', 'Revising', 'Done']);
  });

  it('has a "reading-list" template with correct columnOrder', () => {
    const t = BOARD_TEMPLATES['reading-list'];
    expect(t).toBeDefined();
    expect(t!.groupBy).toBe('status');
    expect(t!.columnOrder).toEqual(['To Read', 'Reading', 'Read']);
  });
});
