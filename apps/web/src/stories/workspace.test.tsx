// @vitest-environment jsdom
/**
 * Author workspace e2e-style tests (F520): load a project, type a compile
 * error into the real CodeMirror editor, watch the status bar/problems panel
 * report it, fix it (quick fix), and watch it clear. Plus library cards
 * (F511) and autosave PUTs (F519).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@uiw/react-codemirror';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, ToastProvider } from '@fables/ui';
import { describe, expect, it } from 'vitest';
import { installCodeMirrorDomStubs } from '../test-utils/cm-dom.js';
import { mockFetchRoutes } from '../test-utils/wrappers.js';
import { StoriesPage } from './StoriesPage.js';
import { StoryEditPage } from './StoryEditPage.js';

installCodeMirrorDomStubs();

const story = {
  id: 's1',
  title: 'The Night-Wood',
  description: '',
  entryFile: 'main.fable',
  status: 'valid' as const,
  errorCount: 0,
  warningCount: 0,
  builtAt: null,
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
};

const CLEAN = '-> den\n\n=== den ===\nThe fox curls up.\n-> END\n';

const file = {
  id: 'file-1',
  storyId: 's1',
  path: 'main.fable',
  source: CLEAN,
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
};

function renderWorkspace(routes = defaultRoutes()) {
  const mocked = mockFetchRoutes(routes);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={['/stories/s1/edit']}>
      <ThemeProvider>
        <ToastProvider>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  const utils = render(
    <Routes>
      <Route path="/stories/:storyId/edit" element={<StoryEditPage />} />
    </Routes>,
    { wrapper },
  );
  return { ...utils, calls: mocked.calls };
}

const defaultRoutes = () => [
  { url: '/api/v1/stories/s1/files/file-1', body: { data: file } },
  { url: '/api/v1/stories/s1/files', body: { data: [file] } },
  { url: '/api/v1/stories/s1', body: { data: story } },
  {
    method: 'PATCH',
    url: '/api/v1/stories/s1/files/file-1',
    body: { data: { file: { ...file, updatedAt: '2026-06-12T01:00:00Z' }, build: null } },
  },
];

const editorView = (): EditorView => {
  const dom = document.querySelector('.cm-content');
  if (dom === null) throw new Error('no editor in the DOM');
  const view = EditorView.findFromDOM(dom as HTMLElement);
  if (view === null) throw new Error('no EditorView attached');
  return view;
};

describe('story workspace (F511–F520)', () => {
  it('edit → compile error appears → quick fix → error clears (F520)', async () => {
    renderWorkspace();

    // Project loads: file tree + tab + clean status bar.
    await waitFor(() => expect(screen.getByTestId('compile-status')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('compile-status').textContent).toContain('0 errors'));
    expect(screen.getAllByText('main.fable').length).toBeGreaterThan(0);

    // Type a broken divert into the real editor.
    const view = editorView();
    view.dispatch({ changes: { from: 0, to: 0, insert: '-> lost_warren\n' } });

    // The client-side project compile reports the error (F513) …
    await waitFor(
      () => expect(screen.getByTestId('compile-status').textContent).toContain('1 errors'),
      { timeout: 3000 },
    );
    // … and the problems panel lists it with a quick fix (F514/F515).
    const panel = screen.getByTestId('problems-panel');
    expect(panel.textContent).toContain('FORGE202');
    const fix = await screen.findByText(/Create knot "lost_warren"/);

    fireEvent.click(fix);
    await waitFor(
      () => expect(screen.getByTestId('compile-status').textContent).toContain('0 errors'),
      { timeout: 3000 },
    );
    expect(editorView().state.doc.toString()).toContain('=== lost_warren ===');
  }, 15000);

  it('autosaves dirty buffers with a debounced PUT (F519)', async () => {
    const { calls } = renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('compile-status')).toBeTruthy());

    const view = editorView();
    view.dispatch({ changes: { from: 0, to: 0, insert: '// note\n' } });
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toContain('unsaved'));

    await waitFor(
      () => {
        const put = calls.find((c) => c.method === 'PATCH' && c.url.includes('/files/file-1'));
        expect(put).toBeTruthy();
        expect((put?.body as { source: string }).source).toContain('// note');
      },
      { timeout: 4000 },
    );
    await waitFor(
      () => expect(screen.getByTestId('save-status').textContent).toContain('all changes saved'),
      { timeout: 4000 },
    );
  }, 15000);

  it('searches across files and jumps from results (F516)', async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('compile-status')).toBeTruthy());

    fireEvent.click(screen.getByText('Search'));
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'fox' } });
    await waitFor(() => {
      const results = screen.getByTestId('search-panel');
      expect(results.textContent).toContain('main.fable:4');
    });
  }, 15000);

  it('falls back to a local scratch project when the server is unreachable', async () => {
    renderWorkspace([]); // every request 404s
    await waitFor(() => expect(screen.getByText(/offline — local only/)).toBeTruthy(), {
      timeout: 3000,
    });
    await waitFor(() => expect(screen.getByTestId('compile-status').textContent).toContain('0 errors'));
  }, 15000);
});

describe('story library (F511)', () => {
  it('lists story cards with status badges', async () => {
    mockFetchRoutes([
      {
        url: '/api/v1/stories',
        body: {
          data: [
            story,
            { ...story, id: 's2', title: 'Broken Tale', status: 'broken', errorCount: 3 },
          ],
        },
      },
    ]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <ThemeProvider>
          <ToastProvider>
            <QueryClientProvider client={queryClient}>
              <StoriesPage />
            </QueryClientProvider>
          </ToastProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('The Night-Wood')).toBeTruthy());
    expect(screen.getByText('Broken Tale')).toBeTruthy();
    expect(screen.getByText('compiles')).toBeTruthy();
    expect(screen.getByText('3 errors')).toBeTruthy();
  });
});
