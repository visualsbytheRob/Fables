// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWrapper, mockFetchRoutes } from '../test-utils/wrappers.js';
import { RelatedPanel } from './RelatedPanel.js';
import type { NoteWithTags } from '../api/client.js';

const mockNote: NoteWithTags = {
  id: 'note-1',
  notebookId: 'nb-1',
  title: 'Test Note',
  body: 'Some content',
  pinned: false,
  trashedAt: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  rev: 1,
  tags: [],
};

const mockNoteWithTags: NoteWithTags = {
  ...mockNote,
  tags: [{ id: 't1', name: 'fiction', color: null, createdAt: '2025-01-01T00:00:00Z' }],
};

const onClose = vi.fn();

const emptyGraph = {
  data: { nodes: [], edges: [], stats: { nodes: 0, edges: 0, orphans: 0, communities: 0 } },
};
const emptyBacklinks = {
  data: { noteId: 'note-1', total: 0, sources: [] },
};

describe('RelatedPanel semantic section (F751/F754)', () => {
  it('renders "Similar by meaning" section with semantic results', async () => {
    mockFetchRoutes([
      { url: '/api/v1/notes/note-1/graph', body: emptyGraph },
      { url: '/api/v1/notes/note-1/backlinks', body: emptyBacklinks },
      {
        url: '/api/v1/notes/note-1/related/semantic',
        body: {
          data: {
            noteId: 'note-1',
            degraded: false,
            results: [
              { id: 'note-2', title: 'Related Story', score: 0.87, snippet: 'About stories', sourceType: 'note' },
              { id: 'note-3', title: 'Another Match', score: 0.72, snippet: 'More content', sourceType: 'note' },
            ],
          },
        },
      },
    ]);

    render(<RelatedPanel note={mockNote} onClose={onClose} />, { wrapper: createWrapper() });

    await waitFor(
      () => expect(screen.queryByText('Related Story')).not.toBeNull(),
      { timeout: 3000 },
    );
    expect(screen.queryByText('Another Match')).not.toBeNull();
    // Score rendered as percentage
    expect(screen.queryByText('87%')).not.toBeNull();
  });

  it('shows "building index" badge when degraded=true', async () => {
    mockFetchRoutes([
      { url: '/api/v1/notes/note-1/graph', body: emptyGraph },
      { url: '/api/v1/notes/note-1/backlinks', body: emptyBacklinks },
      {
        url: '/api/v1/notes/note-1/related/semantic',
        body: {
          data: {
            noteId: 'note-1',
            degraded: true,
            results: [
              { id: 'note-4', title: 'Linked Note', score: 0.5, snippet: 'A linked note', sourceType: 'note' },
            ],
          },
        },
      },
    ]);

    render(<RelatedPanel note={mockNote} onClose={onClose} />, { wrapper: createWrapper() });

    await waitFor(
      () => expect(screen.queryByText('building index')).not.toBeNull(),
      { timeout: 3000 },
    );
    // Shows "linked" instead of percentage when degraded
    expect(screen.queryByText('linked')).not.toBeNull();
  });

  it('shows empty state when no semantic results', async () => {
    mockFetchRoutes([
      { url: '/api/v1/notes/note-1/graph', body: emptyGraph },
      { url: '/api/v1/notes/note-1/backlinks', body: emptyBacklinks },
      {
        url: '/api/v1/notes/note-1/related/semantic',
        body: {
          data: {
            noteId: 'note-1',
            degraded: false,
            results: [],
          },
        },
      },
    ]);

    render(<RelatedPanel note={mockNote} onClose={onClose} />, { wrapper: createWrapper() });

    await waitFor(
      () => expect(screen.queryByText('No similar notes found yet.')).not.toBeNull(),
      { timeout: 3000 },
    );
  });

  it('dismissing a semantic result removes it from view', async () => {
    mockFetchRoutes([
      { url: '/api/v1/notes/note-1/graph', body: emptyGraph },
      { url: '/api/v1/notes/note-1/backlinks', body: emptyBacklinks },
      {
        url: '/api/v1/notes/note-1/related/semantic',
        body: {
          data: {
            noteId: 'note-1',
            degraded: false,
            results: [
              { id: 'note-5', title: 'Dismissable Note', score: 0.9, snippet: 'Content', sourceType: 'note' },
            ],
          },
        },
      },
    ]);

    render(<RelatedPanel note={mockNoteWithTags} onClose={onClose} />, { wrapper: createWrapper() });

    await waitFor(
      () => expect(screen.queryByText('Dismissable Note')).not.toBeNull(),
      { timeout: 3000 },
    );

    const dismissBtn = screen.getByLabelText('Dismiss Dismissable Note');
    fireEvent.click(dismissBtn);

    await waitFor(
      () => expect(screen.queryByText('Dismissable Note')).toBeNull(),
      { timeout: 1000 },
    );
  });
});
