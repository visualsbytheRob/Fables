// @vitest-environment jsdom
/**
 * Saved queries as smart folders + pinning + end-to-end query flow
 * (F282, F287, F290): rendered through the full NotesPage so the sidebar,
 * pinned top-bar chips, query bar, and results list integrate for real.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesPage } from '../notes/NotesPage.js';
import {
  createWrapper,
  emptyPage,
  mockFetchRoutes,
  type FetchRoute,
} from '../test-utils/wrappers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

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

const savedQuery = (id: string, name: string, fql: string, pinned = false) => ({
  id,
  name,
  fql,
  icon: null,
  pinned,
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
});

const baseRoutes: FetchRoute[] = [
  { url: '/notebooks/tree', body: { data: [] } },
  { url: '/tags', body: { data: [] } },
  { url: '/attachments', body: { data: [], page: emptyPage } },
  { url: '/notes?', body: { data: [note('n0', 'Ordinary Note')], page: emptyPage } },
];

describe('saved queries as smart folders (F282)', () => {
  it('lists saved queries and runs one in the note list on click', async () => {
    const { calls } = mockFetchRoutes([
      ...baseRoutes,
      {
        url: '/saved-queries',
        body: { data: [savedQuery('sq1', 'Reading list', 'tag:reading sort:updated desc')] },
      },
      {
        url: '/query?',
        body: {
          data: [note('n1', 'The Fox'), note('n2', 'The Crow')],
          page: emptyPage,
          warnings: [],
        },
      },
    ]);
    render(<NotesPage />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText('Reading list')).toBeDefined());
    fireEvent.click(screen.getByText('Reading list'));

    await waitFor(() => expect(screen.getByTestId('query-results')).toBeDefined());
    await waitFor(() => expect(screen.getByText('The Fox')).toBeDefined());
    const queryCall = calls.find((c) => c.url.includes('/query?'));
    // URLSearchParams encodes spaces as '+'.
    expect(queryCall?.url).toContain('q=tag%3Areading+sort%3Aupdated+desc');
    // The query bar adopted the saved FQL.
    expect((screen.getByLabelText('FQL query') as HTMLInputElement).value).toBe(
      'tag:reading sort:updated desc',
    );
  });

  it('saves the current query bar text as a new smart folder', async () => {
    const { calls } = mockFetchRoutes([
      ...baseRoutes,
      {
        url: '/saved-queries',
        method: 'POST',
        body: { data: savedQuery('sq9', 'Foxes', 'tag:fox') },
        status: 201,
      },
      { url: '/saved-queries', body: { data: [] } },
      { url: '/query?', body: { data: [], page: emptyPage, warnings: [] } },
    ]);
    render(<NotesPage />, { wrapper: createWrapper() });

    const input = await screen.findByLabelText('FQL query');
    fireEvent.change(input, { target: { value: 'tag:fox', selectionStart: 7 } });
    fireEvent.click(screen.getByLabelText('Save current query'));

    const nameInput = await screen.findByLabelText('Saved query name');
    fireEvent.change(nameInput, { target: { value: 'Foxes' } });
    expect((screen.getByLabelText('Saved query FQL') as HTMLInputElement).value).toBe('tag:fox');
    fireEvent.submit(nameInput.closest('form') as HTMLFormElement);

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.includes('/saved-queries'));
      expect(post?.body).toEqual({ name: 'Foxes', fql: 'tag:fox' });
    });
  });
});

describe('saved query pinning (F287)', () => {
  it('shows pinned queries as chips above the query bar and runs them', async () => {
    const { calls } = mockFetchRoutes([
      ...baseRoutes,
      {
        url: '/saved-queries',
        body: {
          data: [
            savedQuery('sq1', 'Inbox', 'notebook:Inbox', true),
            savedQuery('sq2', 'Archive', 'tag:archive', false),
          ],
        },
      },
      { url: '/query?', body: { data: [note('n1', 'Inbox Note')], page: emptyPage, warnings: [] } },
    ]);
    render(<NotesPage />, { wrapper: createWrapper() });

    const toolbar = await screen.findByRole('toolbar', { name: 'Pinned queries' });
    expect(toolbar.textContent).toContain('Inbox');
    expect(toolbar.textContent).not.toContain('Archive'); // unpinned stays sidebar-only

    fireEvent.click(within(toolbar).getByRole('button', { name: /Inbox/ }));
    await waitFor(() => expect(screen.getByText('Inbox Note')).toBeDefined());
    expect(calls.some((c) => c.url.includes(encodeURIComponent('notebook:Inbox')))).toBe(true);
  });

  it('pins a query to the top bar from the sidebar context menu', async () => {
    const { calls } = mockFetchRoutes([
      ...baseRoutes,
      {
        url: '/saved-queries/sq2',
        method: 'PATCH',
        body: { data: savedQuery('sq2', 'Archive', 'tag:archive', true) },
      },
      {
        url: '/saved-queries',
        body: { data: [savedQuery('sq2', 'Archive', 'tag:archive', false)] },
      },
    ]);
    render(<NotesPage />, { wrapper: createWrapper() });

    const row = await screen.findByText('Archive');
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByText('Pin to top bar'));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('/saved-queries/sq2'));
      expect(patch?.body).toEqual({ pinned: true });
    });
  });
});

describe('query bar end-to-end (F278/F279/F290)', () => {
  it('runs a typed query, shows warnings as chips, and clears back to the note list', async () => {
    mockFetchRoutes([
      ...baseRoutes,
      { url: '/saved-queries', body: { data: [] } },
      {
        url: '/query?',
        body: {
          data: [note('n1', 'The Fox')],
          page: emptyPage,
          warnings: ['ignored unparseable clause at position 8: unknown field "bogus"'],
        },
      },
    ]);
    render(<NotesPage />, { wrapper: createWrapper() });

    const input = await screen.findByLabelText('FQL query');
    fireEvent.change(input, { target: { value: 'tag:fox bogus:', selectionStart: 14 } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('The Fox')).toBeDefined());
    expect(screen.getByText(/unknown field "bogus"/)).toBeDefined();

    // Dismiss the warning chip (F279).
    fireEvent.click(screen.getByLabelText(/Dismiss warning/));
    expect(screen.queryByText(/unknown field "bogus"/)).toBeNull();

    // Clear the query → standard note list returns.
    fireEvent.click(screen.getByLabelText('Clear query'));
    await waitFor(() => expect(screen.queryByTestId('query-results')).toBeNull());
    expect(screen.getByLabelText('Filter notes')).toBeDefined();
  });

  it('surfaces fatal query errors as an error chip', async () => {
    mockFetchRoutes([
      ...baseRoutes,
      { url: '/saved-queries', body: { data: [] } },
      {
        url: '/query?',
        status: 400,
        body: {
          error: {
            code: 'VALIDATION',
            message: 'FQL syntax error: unmatched ")"',
            details: { position: 3 },
          },
        },
      },
    ]);
    render(<NotesPage />, { wrapper: createWrapper() });

    const input = await screen.findByLabelText('FQL query');
    fireEvent.change(input, { target: { value: 'a))', selectionStart: 3 } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('FQL syntax error'),
    );
  });
});
