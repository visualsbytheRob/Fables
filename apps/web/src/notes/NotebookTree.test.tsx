// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotebookTreeNode } from '../api/client.js';
import { createWrapper, mockFetchRoutes } from '../test-utils/wrappers.js';
import { NotebookTree } from './NotebookTree.js';

const node = (
  id: string,
  name: string,
  children: NotebookTreeNode[] = [],
  noteCount = 2,
): NotebookTreeNode => ({
  id,
  parentId: null,
  name,
  icon: null,
  color: null,
  archived: false,
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
  noteCount,
  children,
});

const roots = [node('a', 'Worlds', [node('b', 'Characters', [], 5)]), node('c', 'Inbox', [], 0)];

const renderTree = (expanded: Set<string>, onToggle = vi.fn(), onSelect = vi.fn()) => {
  mockFetchRoutes([]);
  render(
    <NotebookTree
      roots={roots}
      selectedId={null}
      onSelect={onSelect}
      expanded={expanded}
      onToggleExpanded={onToggle}
      defaultNotebookId="c"
      onSetDefault={() => {}}
      onNewNote={() => {}}
    />,
    { wrapper: createWrapper() },
  );
  return { onToggle, onSelect };
};

afterEach(() => vi.unstubAllGlobals());

describe('notebook tree (F142/F146/F148)', () => {
  it('hides collapsed children and shows note-count badges', () => {
    renderTree(new Set());
    expect(screen.getByText('Worlds')).toBeDefined();
    expect(screen.queryByText('Characters')).toBeNull();
    expect(screen.getByText('Inbox')).toBeDefined();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0); // badge
  });

  it('shows nested children when expanded and toggles via chevron', () => {
    const { onToggle } = renderTree(new Set(['a']));
    expect(screen.getByText('Characters')).toBeDefined();
    const worldsRow = screen.getByText('Worlds').closest('button')!;
    fireEvent.click(worldsRow.querySelector('.nb-tree__chevron')!);
    expect(onToggle).toHaveBeenCalledWith('a');
  });

  it('selects notebooks and "All notes"', () => {
    const { onSelect } = renderTree(new Set(), vi.fn(), vi.fn());
    fireEvent.click(screen.getByText('Inbox'));
    expect(onSelect).toHaveBeenCalledWith('c');
    fireEvent.click(screen.getByText('All notes'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('opens the management context menu', () => {
    renderTree(new Set());
    fireEvent.contextMenu(screen.getByText('Worlds'));
    expect(screen.getByText('Rename / appearance…')).toBeDefined();
    expect(screen.getByText('New sub-notebook')).toBeDefined();
    expect(screen.getByText('Set as default for capture')).toBeDefined();
    expect(screen.getByText('Archive')).toBeDefined();
    expect(screen.getByText('Delete…')).toBeDefined();
  });

  it('marks the default capture notebook', () => {
    renderTree(new Set());
    expect(document.querySelector('.nb-tree__default')).not.toBeNull();
  });
});
