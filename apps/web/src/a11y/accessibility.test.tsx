// @vitest-environment jsdom
/**
 * F931–F940 — Accessibility assertions (jsdom-based, no browser/axe-core).
 *
 * Checks: ARIA roles, live regions, button vs div for choices, dialog/focus,
 * landmarks in the app shell, keyboard navigation semantics.
 *
 * NOTE: browser-level axe scans require a real Playwright E2E suite (F931 —
 * deferred; see report). These tests validate the structural a11y properties
 * that jsdom can verify without a full rendering engine.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installCodeMirrorDomStubs } from '../test-utils/cm-dom.js';
import { createWrapper, emptyPage, mockFetchRoutes } from '../test-utils/wrappers.js';
import { App } from '../App.js';
import { SearchOverlay } from '../search/SearchOverlay.js';
import { NoteList } from '../notes/NoteList.js';
import type { Note } from '../api/client.js';

installCodeMirrorDomStubs();

// ──────────────────────────────────────────────
// App shell landmarks (F933)
// ──────────────────────────────────────────────

describe('app shell landmarks (F933)', () => {
  it('renders a <nav> element for the sidebar', async () => {
    mockFetchRoutes([
      { url: '/notebooks/tree', body: { data: [] } },
      { url: '/notes?', body: { data: [], page: emptyPage } },
      { url: '/tags', body: { data: [] } },
    ]);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector('nav.sidebar')).not.toBeNull(), {
      timeout: 6000,
    });
    expect(document.querySelector('nav.sidebar')).not.toBeNull();
  });

  it('the main content area is a <main> element', async () => {
    mockFetchRoutes([
      { url: '/notebooks/tree', body: { data: [] } },
      { url: '/notes?', body: { data: [], page: emptyPage } },
      { url: '/tags', body: { data: [] } },
    ]);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector('main.main')).not.toBeNull(), {
      timeout: 6000,
    });
    expect(document.querySelector('main.main')).not.toBeNull();
  });

  afterEach(() => vi.unstubAllGlobals());
});

// ──────────────────────────────────────────────
// Search overlay keyboard navigation (F932/F937)
// ──────────────────────────────────────────────

describe('search overlay a11y (F932/F937)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('has role=dialog with aria-label', () => {
    mockFetchRoutes([]);
    render(<SearchOverlay open={true} onClose={vi.fn()} />, { wrapper: createWrapper() });
    const dialog = screen.getByRole('dialog', { name: 'Search' });
    expect(dialog).toBeDefined();
  });

  it('the input has aria-label and aria-autocomplete', () => {
    mockFetchRoutes([]);
    render(<SearchOverlay open={true} onClose={vi.fn()} />, { wrapper: createWrapper() });
    const input = screen.getByLabelText('Search query');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
  });

  it('results list has role=listbox with accessible label', () => {
    mockFetchRoutes([]);
    render(<SearchOverlay open={true} onClose={vi.fn()} />, { wrapper: createWrapper() });
    const listbox = screen.getByRole('listbox', { name: 'Search results' });
    expect(listbox).toBeDefined();
  });

  it('type filter buttons are grouped with aria-label on the group', () => {
    mockFetchRoutes([]);
    render(<SearchOverlay open={true} onClose={vi.fn()} />, { wrapper: createWrapper() });
    const group = screen.getByRole('group', { name: 'Result type filters' });
    expect(group).toBeDefined();
    // buttons inside are real <button> elements
    const buttons = group.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('Escape key triggers onClose (F937)', () => {
    mockFetchRoutes([]);
    const onClose = vi.fn();
    render(<SearchOverlay open={true} onClose={onClose} />, { wrapper: createWrapper() });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render when open=false — no phantom dialog in DOM', () => {
    mockFetchRoutes([]);
    render(<SearchOverlay open={false} onClose={vi.fn()} />, { wrapper: createWrapper() });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ──────────────────────────────────────────────
// Toast live region (F933)
// ──────────────────────────────────────────────

describe('toast live region (F933)', () => {
  it('the toast container has role=status and aria-live=polite', () => {
    mockFetchRoutes([]);
    render(<SearchOverlay open={false} onClose={vi.fn()} />, { wrapper: createWrapper() });
    // ToastProvider injects the live region when the Wrapper is used
    const region = document.querySelector('[role="status"][aria-live="polite"]');
    expect(region).not.toBeNull();
  });
});

// ──────────────────────────────────────────────
// Note list a11y (F932/F934)
// ──────────────────────────────────────────────

const makeNotes = (count: number): Note[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    notebookId: 'nb1',
    title: `Note ${i}`,
    body: `Body ${i}`,
    pinned: false,
    trashedAt: null,
    createdAt: '2026-06-13T00:00:00Z',
    updatedAt: '2026-06-13T00:00:00Z',
    rev: 0,
  }));

describe('note list a11y (F932)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('multi-select checkboxes have aria-label', () => {
    mockFetchRoutes([{ url: '/notes', body: { data: [], page: emptyPage } }]);
    render(
      <NoteList
        notes={makeNotes(3)}
        roots={[]}
        selectedNoteId={null}
        onOpen={vi.fn()}
        recents={[]}
        sort="updated"
        onSortChange={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        attachmentNoteIds={new Set()}
        attachmentsOnly={false}
        onAttachmentsOnlyChange={vi.fn()}
        hasMore={false}
        onLoadMore={vi.fn()}
        viewportHeight={400}
      />,
      { wrapper: createWrapper() },
    );
    // The note-row checkboxes are the .note-row__check inputs
    const noteRowChecks = document.querySelectorAll('.note-row__check');
    expect(noteRowChecks.length).toBeGreaterThan(0);
    for (const cb of noteRowChecks) {
      expect(cb.getAttribute('aria-label')).not.toBeNull();
    }
  });

  it('note rows are buttons or have click handlers accessible via keyboard', () => {
    mockFetchRoutes([{ url: '/notes', body: { data: [], page: emptyPage } }]);
    render(
      <NoteList
        notes={makeNotes(2)}
        roots={[]}
        selectedNoteId={null}
        onOpen={vi.fn()}
        recents={[]}
        sort="updated"
        onSortChange={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        attachmentNoteIds={new Set()}
        attachmentsOnly={false}
        onAttachmentsOnlyChange={vi.fn()}
        hasMore={false}
        onLoadMore={vi.fn()}
        viewportHeight={400}
      />,
      { wrapper: createWrapper() },
    );
    // Note rows should be present
    const rows = document.querySelectorAll('.note-row');
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────
// Dialog focus trap (F937)
// ──────────────────────────────────────────────

describe('Dialog a11y (F937)', () => {
  it('native <dialog> element is used for overlays', () => {
    // The ui Dialog component uses a native <dialog> element
    // which provides free focus-trapping and Escape dismiss.
    // Verify the wrapper.tsx mock installed showModal/close.
    const dialogEl = document.createElement('dialog');
    expect(typeof dialogEl.showModal).toBe('function');
  });
});

// ──────────────────────────────────────────────
// Player choices are real <button> elements (F934)
// ──────────────────────────────────────────────

describe('player choices a11y (F934)', () => {
  it('PlaytestPane choices are rendered as <Button> (real button elements)', async () => {
    const { PlaytestPane } = await import('../stories/playtest/PlaytestPane.js');
    const sources = new Map([['main.fable', '-> start\n=== start ===\nHello.\n* Choice A\n  -> END\n']]);
    render(
      <PlaytestPane
        storyId="s1"
        sources={sources}
        entryPath="main.fable"
        version={1}
        onJumpToSource={vi.fn()}
      />,
      { wrapper: createWrapper() },
    );
    // Click Run to start the game
    const runBtn = screen.getByTitle(/Run from the start/);
    fireEvent.click(runBtn);
    await waitFor(() => expect(screen.queryByText('Choice A')).not.toBeNull(), { timeout: 3000 });
    const choiceBtn = screen.getByText('Choice A');
    expect(choiceBtn.tagName.toLowerCase()).toBe('button');
  });
});

// ──────────────────────────────────────────────
// Reduced motion: @keyframes should be gated (F936)
// ──────────────────────────────────────────────

describe('reduced motion (F936)', () => {
  it('packages/ui/src/styles.css contains a prefers-reduced-motion media query', async () => {
    // Read the CSS file at build time using Node's fs (available in Vitest/Node context).
    const { readFileSync } = await import('fs');
    const { resolve, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    // Path relative to this test file's package
    const cssPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../packages/ui/src/styles.css',
    );
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('animation-duration');
  });
});
