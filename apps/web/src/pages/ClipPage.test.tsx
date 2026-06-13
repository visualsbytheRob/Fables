// @vitest-environment jsdom
/**
 * Web clipper UI (F771–F773).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../api/client.js';
import { createWrapper, mockFetchRoutes } from '../test-utils/wrappers.js';
import { ClipPage } from './ClipPage.js';

afterEach(() => vi.unstubAllGlobals());

const makeNote = (over: Partial<Note> = {}): Note => ({
  id: 'note_1',
  notebookId: 'nb_1',
  title: 'Example Page',
  body: '',
  pinned: false,
  trashedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  rev: 1,
  ...over,
});

describe('web clipper (F771–F773)', () => {
  it('renders URL input and Clip page button', () => {
    render(<ClipPage />, { wrapper: createWrapper() });
    expect(screen.getByLabelText('URL to clip')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Clip page' })).toBeDefined();
  });

  it('disables clip button when URL is empty', () => {
    render(<ClipPage />, { wrapper: createWrapper() });
    const btn = screen.getByRole('button', { name: 'Clip page' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('clips a URL and links to the created note', async () => {
    const { calls } = mockFetchRoutes([
      {
        url: '/clip',
        method: 'POST',
        body: { data: { note: makeNote(), duplicate: false } },
      },
    ]);
    render(<ClipPage />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText('URL to clip'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clip page' }));

    await waitFor(() => expect(screen.getByLabelText('Clip result')).toBeDefined());
    expect(screen.getByText(/Open:/)).toBeDefined();
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/clip'));
    expect(post?.body).toMatchObject({ url: 'https://example.com' });
  });

  it('shows a duplicate notice when server returns duplicate:true (F771)', async () => {
    mockFetchRoutes([
      {
        url: '/clip',
        method: 'POST',
        body: { data: { note: makeNote(), duplicate: true } },
      },
    ]);
    render(<ClipPage />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText('URL to clip'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clip page' }));

    await waitFor(() => expect(screen.getByLabelText('Duplicate clip notice')).toBeDefined());
    expect(screen.getByLabelText('Duplicate clip notice').textContent).toContain('already clipped');
  });

  it('shows an error when clipping fails', async () => {
    mockFetchRoutes([
      {
        url: '/clip',
        method: 'POST',
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'fetch failed', details: null } },
      },
    ]);
    render(<ClipPage />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText('URL to clip'), {
      target: { value: 'https://fail.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clip page' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toContain('fetch failed');
  });

  it('shows the bookmarklet generator section (F772)', () => {
    render(<ClipPage />, { wrapper: createWrapper() });
    expect(screen.getByLabelText('Bookmarklet generator')).toBeDefined();
    // The bookmarklet link is a draggable span with role="link"
    expect(screen.getByRole('link', { name: 'Clip to Fables bookmarklet' })).toBeDefined();
  });

  it('shows the iOS share-target instructions card (F773)', () => {
    render(<ClipPage />, { wrapper: createWrapper() });
    expect(screen.getByLabelText('iOS share target')).toBeDefined();
    expect(screen.getByText(/Add to Home Screen/)).toBeDefined();
  });
});
