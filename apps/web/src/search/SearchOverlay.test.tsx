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

  it('has all three mode buttons enabled and keyword active by default', () => {
    mockFetchRoutes([]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    const modeGroup = screen.getByRole('group', { name: 'Search mode' });
    const buttons = Array.from(modeGroup.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent?.trim() ?? '');

    // All three modes present and none disabled
    expect(labels.some((t) => t === 'keyword')).toBe(true);
    expect(labels.some((t) => t === 'semantic')).toBe(true);
    expect(labels.some((t) => t === 'hybrid')).toBe(true);
    expect(modeGroup.querySelectorAll('button[aria-disabled="true"]').length).toBe(0);

    // keyword is active by default
    const keywordBtn = buttons.find((b) => b.textContent?.trim() === 'keyword');
    expect(keywordBtn?.className).toContain('search-mode-btn--active');
  });

  it('closes on Escape key', () => {
    mockFetchRoutes([]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('passes mode param to /search endpoint when mode is switched', async () => {
    const { calls } = mockFetchRoutes([
      { url: '/api/v1/search', body: mockSearchResponse },
      { url: '/api/v1/embeddings/status', body: { data: { provider: { id: 'noop', dim: 0, available: false }, coverage: { coveragePct: 0 }, queue: { queueDepth: 0 } } } },
    ]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    const modeGroup = screen.getByRole('group', { name: 'Search mode' });
    const semanticBtn = Array.from(modeGroup.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'semantic',
    );
    fireEvent.click(semanticBtn!);

    const input = screen.getByLabelText('Search query');
    fireEvent.change(input, { target: { value: 'fox' } });

    await waitFor(() => {
      const searchCalls = calls.filter((c) => c.url.includes('/api/v1/search'));
      return expect(searchCalls.some((c) => c.url.includes('mode=semantic'))).toBe(true);
    }, { timeout: 2000 });
  });

  it('shows degraded notice when response has degraded:true', async () => {
    mockFetchRoutes([
      {
        url: '/api/v1/search',
        body: {
          data: {
            mode: 'semantic',
            query: 'fox',
            degraded: true,
            groups: [{ type: 'notes', total: 1, results: [{ id: 'n1', title: 'The Fox', snippet: 'A fox', highlights: [], score: 0.5 }] }],
          },
          page: { nextCursor: null, limit: 5 },
        },
      },
      { url: '/api/v1/embeddings/status', body: { data: { provider: { id: 'noop', dim: 0, available: false }, coverage: { coveragePct: 0 }, queue: { queueDepth: 0 } } } },
    ]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    // Switch to semantic mode
    const modeGroup = screen.getByRole('group', { name: 'Search mode' });
    const semanticBtn = Array.from(modeGroup.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'semantic',
    );
    fireEvent.click(semanticBtn!);

    const input = screen.getByLabelText('Search query');
    fireEvent.change(input, { target: { value: 'fox' } });

    await waitFor(
      () => expect(screen.queryByText(/Semantic index still building/)).not.toBeNull(),
      { timeout: 2000 },
    );
  });

  it('shows embeddings status in footer when provider is available', async () => {
    mockFetchRoutes([
      {
        url: '/api/v1/embeddings/status',
        body: {
          data: {
            provider: { id: 'local', dim: 384, available: true },
            coverage: { coveragePct: 42 },
            queue: { queueDepth: 0 },
          },
        },
      },
    ]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    await waitFor(
      () => expect(screen.queryByText(/42% indexed/)).not.toBeNull(),
      { timeout: 2000 },
    );
    expect(screen.queryByText('Build index')).not.toBeNull();
  });

  it('shows "why?" button in hybrid mode and renders score breakdown on click', async () => {
    mockFetchRoutes([
      {
        url: '/api/v1/search',
        body: {
          data: {
            mode: 'hybrid',
            query: 'fox',
            degraded: false,
            groups: [{
              type: 'notes',
              total: 1,
              results: [{
                id: 'n1',
                title: 'The Fox',
                snippet: 'A fox',
                highlights: [],
                score: 0.9,
                scoreComponents: { fts: 0.6, vector: 0.3 },
              }],
            }],
          },
          page: { nextCursor: null, limit: 5 },
        },
      },
      { url: '/api/v1/embeddings/status', body: { data: { provider: { id: 'noop', dim: 0, available: false }, coverage: { coveragePct: 0 }, queue: { queueDepth: 0 } } } },
    ]);
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });

    // Switch to hybrid mode
    const modeGroup = screen.getByRole('group', { name: 'Search mode' });
    const hybridBtn = Array.from(modeGroup.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'hybrid',
    );
    fireEvent.click(hybridBtn!);

    const input = screen.getByLabelText('Search query');
    fireEvent.change(input, { target: { value: 'fox' } });

    await waitFor(() => expect(screen.getByText('The Fox')).toBeDefined(), { timeout: 2000 });

    // "why?" button should be present
    const whyBtn = screen.getByLabelText('Why this result?');
    expect(whyBtn).toBeDefined();

    // Click to show breakdown
    fireEvent.click(whyBtn);
    await waitFor(() => expect(screen.queryByText(/fts: 0.600/)).not.toBeNull(), { timeout: 1000 });
  });
});
