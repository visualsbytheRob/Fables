// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWrapper, emptyPage, mockFetchRoutes } from '../test-utils/wrappers.js';
import { QuickSwitcher } from './QuickSwitcher.js';

const note = (id: string, title: string) => ({
  id,
  notebookId: 'nb1',
  title,
  body: '',
  pinned: false,
  trashedAt: null,
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
  rev: 0,
});

afterEach(() => vi.unstubAllGlobals());

describe('quick switcher (F176)', () => {
  it('opens on Mod-P, fuzzy filters, and opens the picked note', async () => {
    mockFetchRoutes([
      {
        url: '/notes?',
        body: { data: [note('n1', 'The Fox'), note('n2', 'Compiler Notes')], page: emptyPage },
      },
    ]);
    const onOpen = vi.fn();
    render(<QuickSwitcher onOpen={onOpen} />, { wrapper: createWrapper() });

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    await waitFor(() => expect(screen.getByText('The Fox')).toBeDefined());

    const input = screen.getByPlaceholderText('Jump to note…');
    fireEvent.change(input, { target: { value: 'cmplr' } });
    await waitFor(() => expect(screen.queryByText('The Fox')).toBeNull());
    expect(screen.getByText('Compiler Notes')).toBeDefined();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('n2');
    // closed after picking
    expect(screen.queryByPlaceholderText('Jump to note…')).toBeNull();
  });
});
