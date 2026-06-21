// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWrapper, mockFetchRoutes, type FetchRoute } from '../test-utils/wrappers.js';
import { InsightsPage } from './InsightsPage.js';

const overview = {
  notes: 42,
  notebooks: 5,
  entities: 10,
  stories: 3,
  links: 88,
  orphans: 4,
  wordsTotal: 12000,
};

const streaks = {
  current: 7,
  longest: 14,
  heatmap: [],
};

const reading = { plays: 0, turns: 0, completions: 0, topScenes: [] };
const deadEnds = { orphanNotes: [], brokenLinks: [] };

/** The full route set the page fetches; callers can override individual entries. */
function routes(overrides: FetchRoute[] = []): FetchRoute[] {
  const base: FetchRoute[] = [
    { url: '/api/v1/insights/overview', body: { data: overview } },
    { url: '/api/v1/insights/growth', body: { data: [] } },
    { url: '/api/v1/insights/streaks', body: { data: streaks } },
    { url: '/api/v1/insights/stale', body: { data: [] } },
    { url: '/api/v1/insights/suggested-links', body: { data: [] } },
    { url: '/api/v1/insights/reading', body: { data: reading } },
    { url: '/api/v1/insights/dead-ends', body: { data: deadEnds } },
    { url: '/api/v1/insights/health', body: { data: { score: 80, checklist: [] } } },
  ];
  const byUrl = new Map(base.map((r) => [r.url, r]));
  for (const o of overrides) byUrl.set(o.url, o);
  return [...byUrl.values()];
}

afterEach(() => vi.unstubAllGlobals());

describe('InsightsPage (F791–F800)', () => {
  it('renders overview stat cards', async () => {
    mockFetchRoutes(routes());

    render(<InsightsPage />, { wrapper: createWrapper(['/insights']) });

    await waitFor(() => expect(screen.getByText('42')).toBeDefined(), { timeout: 3000 });
    expect(screen.getByText('Notes')).toBeDefined();
    expect(screen.getByText('88')).toBeDefined(); // links
  });

  it('renders streak stats', async () => {
    mockFetchRoutes(routes());

    render(<InsightsPage />, { wrapper: createWrapper(['/insights']) });

    await waitFor(() => expect(screen.getByText('7')).toBeDefined(), { timeout: 3000 });
    expect(screen.getByText('Current streak (days)')).toBeDefined();
    expect(screen.getByText('14')).toBeDefined();
  });

  it('renders vault health score and checklist', async () => {
    mockFetchRoutes(
      routes([
        {
          url: '/api/v1/insights/health',
          body: {
            data: {
              score: 85,
              checklist: [
                { key: 'orphans', label: 'No orphan notes', ok: false },
                { key: 'links', label: 'Good link density', ok: true },
              ],
            },
          },
        },
      ]),
    );

    render(<InsightsPage />, { wrapper: createWrapper(['/insights']) });

    await waitFor(() => expect(screen.getByText('85')).toBeDefined(), { timeout: 3000 });
    expect(screen.getByText('No orphan notes')).toBeDefined();
    expect(screen.getByText('Good link density')).toBeDefined();
  });
});
