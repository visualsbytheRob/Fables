// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../api/client.js';
import { createWrapper, emptyPage, mockFetchRoutes } from '../test-utils/wrappers.js';
import { NoteList, ROW_HEIGHT } from './NoteList.js';

const makeNotes = (count: number): Note[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    notebookId: 'nb1',
    title: `Note ${i}`,
    body: `Body of note ${i} #tag${i % 3}`,
    pinned: i === 0,
    trashedAt: null,
    createdAt: '2026-06-12T00:00:00Z',
    updatedAt: '2026-06-12T00:00:00Z',
    rev: 0,
  }));

const renderList = (notes: Note[], over: Partial<Parameters<typeof NoteList>[0]> = {}) => {
  mockFetchRoutes([{ url: '/notes', body: { data: [], page: emptyPage } }]);
  const onOpen = vi.fn();
  render(
    <NoteList
      notes={notes}
      roots={[]}
      selectedNoteId={null}
      onOpen={onOpen}
      recents={[]}
      sort="updated"
      onSortChange={() => {}}
      query=""
      onQueryChange={() => {}}
      attachmentNoteIds={new Set()}
      attachmentsOnly={false}
      onAttachmentsOnlyChange={() => {}}
      hasMore={false}
      onLoadMore={() => {}}
      viewportHeight={300}
      {...over}
    />,
    { wrapper: createWrapper() },
  );
  return { onOpen };
};

afterEach(() => vi.unstubAllGlobals());

describe('note list (F171/F172/F174/F177)', () => {
  it('windows large lists: renders a small slice of 500 notes', () => {
    renderList(makeNotes(500));
    const rendered = document.querySelectorAll('.note-row');
    expect(rendered.length).toBeGreaterThan(5);
    expect(rendered.length).toBeLessThan(30);
  });

  it('re-windows on scroll', () => {
    renderList(makeNotes(500));
    expect(screen.queryByText('Note 200')).toBeNull();
    fireEvent.scroll(screen.getByTestId('note-scroll'), {
      target: { scrollTop: 200 * ROW_HEIGHT },
    });
    expect(screen.getByText('Note 200')).toBeDefined();
  });

  it('shows pinned section, snippet, and tag chips', () => {
    renderList(makeNotes(3));
    expect(screen.getByText('Pinned')).toBeDefined();
    expect(screen.getByText('Body of note 1 #tag1')).toBeDefined();
    expect(screen.getAllByText('#tag1').length).toBeGreaterThan(0);
  });

  it('opens a note on click and shows the bulk toolbar on selection', () => {
    const { onOpen } = renderList(makeNotes(3));
    fireEvent.click(screen.getByText('Note 1'));
    expect(onOpen).toHaveBeenCalledWith('n1');

    fireEvent.click(screen.getByLabelText('Select Note 2'));
    expect(screen.getByText('1 selected')).toBeDefined();
    expect(screen.getByText('Move…')).toBeDefined();
    expect(screen.getByText('Trash')).toBeDefined();
  });

  it('opens a context menu with note actions (F175)', () => {
    renderList(makeNotes(3));
    fireEvent.contextMenu(screen.getByText('Note 1'));
    expect(screen.getByText('Duplicate')).toBeDefined();
    expect(screen.getByText('Move to trash')).toBeDefined();
    expect(screen.getByText('Pin')).toBeDefined();
  });
});
