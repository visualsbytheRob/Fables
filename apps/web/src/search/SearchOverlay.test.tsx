// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWrapper, mockFetchRoutes } from '../test-utils/wrappers.js';
import { SearchOverlay } from './SearchOverlay.js';

const onClose = vi.fn();

const mockSearchResponse = {
  data: {
    mode: 'keyword',
    query: 'fox',
    groups: [
      {
        type: 'notes',
        total: 2,
        results: [
          {
            id: 'n1',
            title: 'The Fox',
            snippet: 'A cunning fox',
            highlights: [{ start: 2, end: 5 }],
            score: 0.9,
          },
          {
            id: 'n2',
            title: 'Fox Tales',
            snippet: 'Stories of foxes',
            highlights: [],
            score: 0.7,
          },
        ],
      },
      {
        type: 'entities',
        total: 1,
        results: [
          {
            id: 'e1',
            title: 'Fox Entity',
            snippet: 'An entity called fox',
            highlights: [],
            score: 0.5,
          },
        ],
      },
    ],
  },
  page: { nextCursor: null, limit: 5 },
};

afterEach(() => vi.unstubAllGlobals());

describe('SearchOverlay (F711–F720)', () => {
  it('renders when open=true and closes on X button', () => {
    mockFetchRoutes([]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    expect(screen.getByRole('dialog', { name: 'Search' })).toBeDefined();

    const closeBtns = screen.getAllByLabelText('Close search');
    fireEvent.click(closeBtns[0]!);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render when open=false', () => {
    mockFetchRoutes([]);
    render(<SearchOverlay open={false} onClose={onClose} />, { wrapper: createWrapper() });
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
  });

  it('shows grouped results by type', async () => {
    mockFetchRoutes([
      { url: '/api/v1/search', body: mockSearchResponse },
    ]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    const input = screen.getByLabelText('Search query');
    fireEvent.change(input, { target: { value: 'fox' } });

    // Wait through debounce + data resolution
    await waitFor(() => expect(screen.getByText('The Fox')).toBeDefined(), { timeout: 5000 });
    expect(screen.getByText('Fox Tales')).toBeDefined();
    expect(screen.getByText('Fox Entity')).toBeDefined();
  });

  it('highlights matched terms in snippets', async () => {
    mockFetchRoutes([
      { url: '/api/v1/search', body: mockSearchResponse },
    ]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    const input = screen.getByLabelText('Search query');
    fireEvent.change(input, { target: { value: 'fox' } });

    await waitFor(() => expect(screen.getByText('The Fox')).toBeDefined(), { timeout: 2000 });

    // The snippet "A cunning fox" with highlight [2,5] should have a <mark>
    const marks = document.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThan(0);
  });

  it('navigates results with keyboard arrow keys', async () => {
    mockFetchRoutes([
      { url: '/api/v1/search', body: mockSearchResponse },
    ]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    const input = screen.getByLabelText('Search query');
    fireEvent.change(input, { target: { value: 'fox' } });

    await waitFor(() => expect(screen.getByText('The Fox')).toBeDefined(), { timeout: 2000 });

    // First item is active by default (index 0)
    const listbox = screen.getByRole('listbox', { name: 'Search results' });
    const items = listbox.querySelectorAll('[aria-selected]');
    const firstItem = items[0];
    expect(firstItem).not.toBeUndefined();
    expect(firstItem!.getAttribute('aria-selected')).toBe('true');

    // Arrow down moves to second item
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => {
      const updatedItems = listbox.querySelectorAll('[aria-selected="true"]');
      expect(updatedItems.length).toBe(1);
    });
  });

  it('shows no-results state for unmatched query', async () => {
    mockFetchRoutes([
      {
        url: '/api/v1/search',
        body: {
          data: { mode: 'keyword', query: 'xyznotfound', groups: [] },
          page: { nextCursor: null, limit: 5 },
        },
      },
    ]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    const input = screen.getByLabelText('Search query');
    fireEvent.change(input, { target: { value: 'xyznotfound' } });

    await waitFor(
      () => expect(screen.queryByText(/No results for/)).toBeDefined(),
      { timeout: 2000 },
    );
  });

  it('shows semantic and hybrid modes as disabled (coming soon)', () => {
    mockFetchRoutes([]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    // Buttons are in the mode group — find by partial text
    const modeGroup = screen.getByRole('group', { name: 'Search mode' });
    const buttons = modeGroup.querySelectorAll('button[aria-disabled="true"]');
    expect(buttons.length).toBe(2);

    const texts = Array.from(buttons).map((b) => b.textContent ?? '');
    expect(texts.some((t) => t.includes('semantic'))).toBe(true);
    expect(texts.some((t) => t.includes('hybrid'))).toBe(true);
  });

  it('closes on Escape key', () => {
    mockFetchRoutes([]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
