// @vitest-environment jsdom
/**
 * Query embed blocks (F283–F286, F289): live results in list/table/count
 * modes, manual refresh, the dashboard-note pattern, and the depth/recursion
 * + result-cap guards.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../api/client.js';
import {
  createWrapper,
  emptyPage,
  mockFetchRoutes,
  type FetchCall,
} from '../test-utils/wrappers.js';
import { MarkdownPreview } from './MarkdownPreview.js';
import type { QueryEmbedHandlers } from './QueryEmbed.js';

afterEach(() => vi.unstubAllGlobals());

const note = (id: string, title: string, body = ''): Note => ({
  id,
  notebookId: 'nb1',
  title,
  body,
  pinned: false,
  trashedAt: null,
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
  rev: 0,
});

const handlers = (onOpenNote = vi.fn()): QueryEmbedHandlers => ({ onOpenNote });

const fence = (content: string) => '```fql\n' + content + '\n```';

const queryCalls = (calls: FetchCall[]) => calls.filter((c) => c.url.includes('/query?'));

describe('fql embed blocks (F283/F284)', () => {
  it('renders list-mode results with clickable titles', async () => {
    mockFetchRoutes([
      {
        url: '/query?',
        body: {
          data: [note('n1', 'The Fox'), note('n2', 'The Crow')],
          page: emptyPage,
          warnings: [],
        },
      },
    ]);
    const onOpenNote = vi.fn();
    render(<MarkdownPreview source={fence('tag:reading')} fqlEmbeds={handlers(onOpenNote)} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(screen.getByText('The Fox')).toBeDefined());
    fireEvent.click(screen.getByText('The Crow'));
    expect(onOpenNote).toHaveBeenCalledWith('n2');
  });

  it('renders table mode with title and updated columns', async () => {
    mockFetchRoutes([
      {
        url: '/query?',
        body: { data: [note('n1', 'The Fox')], page: emptyPage, warnings: [] },
      },
    ]);
    const { container } = render(
      <MarkdownPreview source={fence('mode: table\ntag:reading')} fqlEmbeds={handlers()} />,
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(container.querySelector('.fql-embed__table')).not.toBeNull());
    expect(screen.getByText('The Fox')).toBeDefined();
    expect(screen.getByText('Updated')).toBeDefined();
  });

  it('renders count mode as a number', async () => {
    mockFetchRoutes([
      {
        url: '/query?',
        body: { data: [note('n1', 'A'), note('n2', 'B')], page: emptyPage, warnings: [] },
      },
    ]);
    const { container } = render(
      <MarkdownPreview source={fence('mode: count\npinned:true')} fqlEmbeds={handlers()} />,
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(container.querySelector('.fql-embed__count strong')?.textContent).toBe('2'),
    );
  });

  it('surfaces server warnings and query errors inside the embed (F279)', async () => {
    mockFetchRoutes([
      {
        url: '/query?',
        body: { data: [], page: emptyPage, warnings: ['ignored unparseable clause at 4'] },
      },
    ]);
    render(<MarkdownPreview source={fence('tag:x ???')} fqlEmbeds={handlers()} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(screen.getByText('ignored unparseable clause at 4')).toBeDefined());
  });

  it('renders plain code when no embed handlers are wired', () => {
    const { container } = render(<MarkdownPreview source={fence('tag:reading')} />);
    expect(container.querySelector('.fql-embed')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toContain('tag:reading');
  });
});

describe('embed refresh + cache (F285)', () => {
  it('refetches on the refresh control', async () => {
    const { calls } = mockFetchRoutes([
      { url: '/query?', body: { data: [note('n1', 'A')], page: emptyPage, warnings: [] } },
    ]);
    render(<MarkdownPreview source={fence('tag:reading')} fqlEmbeds={handlers()} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(screen.getByText('A')).toBeDefined());
    expect(queryCalls(calls)).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Refresh query results'));
    await waitFor(() => expect(queryCalls(calls)).toHaveLength(2));
  });

  it('two embeds with the same query share one cached request', async () => {
    const { calls } = mockFetchRoutes([
      { url: '/query?', body: { data: [note('n1', 'A')], page: emptyPage, warnings: [] } },
    ]);
    const md = `${fence('tag:reading')}\n\n${fence('tag:reading')}`;
    render(<MarkdownPreview source={md} fqlEmbeds={handlers()} />, { wrapper: createWrapper() });
    await waitFor(() => expect(screen.getAllByText('A')).toHaveLength(2));
    expect(queryCalls(calls)).toHaveLength(1);
  });
});

describe('dashboard note pattern (F286)', () => {
  it('renders a note made of several differently-moded embeds', async () => {
    mockFetchRoutes([
      {
        url: /q=tag%3Areading/,
        body: { data: [note('n1', 'Reading Log')], page: emptyPage, warnings: [] },
      },
      {
        url: /q=pinned%3Atrue/,
        body: {
          data: [note('n2', 'Pinned Plan'), note('n3', 'Pinned Map')],
          page: emptyPage,
          warnings: [],
        },
      },
    ]);
    const md = [
      '# Dashboard',
      '',
      '## Reading',
      fence('tag:reading'),
      '',
      '## Pinned',
      fence('mode: table\npinned:true'),
      '',
      '## Stats',
      fence('mode: count\npinned:true'),
    ].join('\n');
    const { container } = render(<MarkdownPreview source={md} fqlEmbeds={handlers()} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(screen.getByText('Reading Log')).toBeDefined());
    await waitFor(() => expect(screen.getAllByText('Pinned Plan')).toHaveLength(1));
    await waitFor(() =>
      expect(container.querySelector('.fql-embed__count strong')?.textContent).toBe('2'),
    );
    expect(container.querySelectorAll('.fql-embed')).toHaveLength(3);
  });
});

describe('depth + result-count guards (F289)', () => {
  it('never renders nested embeds beyond depth 1', async () => {
    const nestedBody = '```fql\npinned:true\n```';
    const { calls } = mockFetchRoutes([
      {
        url: '/query?',
        body: { data: [note('n1', 'Inner Dashboard', nestedBody)], page: emptyPage, warnings: [] },
      },
    ]);
    render(<MarkdownPreview source={fence('tag:dash')} fqlEmbeds={handlers()} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(screen.getByText('Inner Dashboard')).toBeDefined());
    // The result body's own fql fence renders as a guard note, not a live embed…
    await waitFor(() =>
      expect(screen.getByText(/Nested query embeds are not rendered/)).toBeDefined(),
    );
    // …so exactly one query ran (the outer embed's).
    expect(queryCalls(calls)).toHaveLength(1);
    expect(queryCalls(calls)[0]?.url).toContain('q=tag%3Adash');
  });

  it('caps rendered results at the embed limit', async () => {
    const many = Array.from({ length: 30 }, (_, i) => note(`n${i}`, `Note ${i}`));
    const { calls } = mockFetchRoutes([
      { url: '/query?', body: { data: many, page: emptyPage, warnings: [] } },
    ]);
    const { container } = render(
      <MarkdownPreview source={fence('limit: 3\ntag:x')} fqlEmbeds={handlers()} />,
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(screen.getByText('Note 0')).toBeDefined());
    expect(container.querySelectorAll('.fql-embed__list > li')).toHaveLength(3);
    expect(queryCalls(calls)[0]?.url).toContain('limit=3');
  });

  it('clamps absurd limits to the hard cap (F289)', async () => {
    const { calls } = mockFetchRoutes([
      { url: '/query?', body: { data: [], page: emptyPage, warnings: [] } },
    ]);
    render(<MarkdownPreview source={fence('limit: 9999\ntag:x')} fqlEmbeds={handlers()} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(queryCalls(calls)).toHaveLength(1));
    expect(queryCalls(calls)[0]?.url).toContain('limit=50');
    expect(screen.getByText(/limit capped at 50/)).toBeDefined();
  });
});
