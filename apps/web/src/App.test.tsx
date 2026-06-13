// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installCodeMirrorDomStubs } from './test-utils/cm-dom.js';
import { emptyPage, mockFetchRoutes } from './test-utils/wrappers.js';
import { App } from './App.js';

installCodeMirrorDomStubs();

const note = {
  id: 'n1',
  notebookId: 'nb1',
  title: 'The Fox and the Compiler',
  body: 'A **fox** found a compiler.',
  pinned: false,
  trashedAt: null,
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
  rev: 2,
};

const treeNode = {
  id: 'nb1',
  parentId: null,
  name: 'Fables',
  icon: null,
  color: null,
  archived: false,
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
  noteCount: 1,
  children: [],
};

const routes = () =>
  mockFetchRoutes([
    { url: '/notebooks/tree', body: { data: [treeNode] } },
    { url: '/notes/n1/revisions', body: { data: [] } },
    { url: '/notes/n1', body: { data: { ...note, tags: [] } } },
    { url: '/notes?', body: { data: [note], page: emptyPage } },
    { url: '/tags', body: { data: [] } },
    { url: '/attachments', body: { data: [], page: emptyPage } },
  ]);

afterEach(() => vi.unstubAllGlobals());

describe('app shell', () => {
  it('renders navigation and the notes page with the note list', async () => {
    routes();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('Fables')).toBeDefined();
    expect(screen.getByText('Stories')).toBeDefined();
    // the lazily-loaded notes page mounts with the real list
    await waitFor(() => expect(screen.getByText('The Fox and the Compiler')).toBeDefined(), { timeout: 8000 });
    expect(screen.getByText(/Select a note/)).toBeDefined();
  });

  it('deep links straight into a note (F180)', async () => {
    routes();
    render(
      <MemoryRouter initialEntries={['/notes/n1']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        const title = screen.getByLabelText('Note title') as HTMLInputElement;
        expect(title.value).toBe('The Fox and the Compiler');
      },
      { timeout: 8000 },
    );
    // editor mounts with the note body
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull(), { timeout: 8000 });
  });
});
