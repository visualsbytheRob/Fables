// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWrapper, mockFetchRoutes } from '../test-utils/wrappers.js';
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
  currentStreak: 7,
  longestStreak: 14,
  heatmap: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('InsightsPage (F791–F800)', () => {
  it('renders overview stat cards', async () => {
    mockFetchRoutes([
      { url: '/api/v1/insights/overview', body: { data: overview } },
      { url: '/api/v1/insights/growth', body: { data: [] } },
      { url: '/api/v1/insights/streaks', body: { data: streaks } },
      { url: '/api/v1/insights/stale', body: { data: [] } },
      { url: '/api/v1/insights/suggested-links', body: { data: [] } },
      { url: '/api/v1/insights/reading', body: { data: [] } },
      { url: '/api/v1/insights/dead-ends', body: { data: [] } },
      { url: '/api/v1/insights/health', body: { data: { score: 80, checklist: [] } } },
    ]);

    render(<InsightsPage />, { wrapper: createWrapper(['/insights']) });

    await waitFor(() => expect(screen.getByText('42')).toBeDefined(), { timeout: 3000 });
    expect(screen.getByText('Notes')).toBeDefined();
    expect(screen.getByText('88')).toBeDefined(); // links
  });

  it('renders streak stats', async () => {
    mockFetchRoutes([
      { url: '/api/v1/insights/overview', body: { data: overview } },
      { url: '/api/v1/insights/growth', body: { data: [] } },
      { url: '/api/v1/insights/streaks', body: { data: streaks } },
      { url: '/api/v1/insights/stale', body: { data: [] } },
      { url: '/api/v1/insights/suggested-links', body: { data: [] } },
      { url: '/api/v1/insights/reading', body: { data: [] } },
      { url: '/api/v1/insights/dead-ends', body: { data: [] } },
      { url: '/api/v1/insights/health', body: { data: { score: 80, checklist: [] } } },
    ]);

    render(<InsightsPage />, { wrapper: createWrapper(['/insights']) });

    await waitFor(() => expect(screen.getByText('7')).toBeDefined(), { timeout: 3000 });
    expect(screen.getByText('Current streak (days)')).toBeDefined();
    expect(screen.getByText('14')).toBeDefined();
  });

  it('renders vault health score and checklist', async () => {
    mockFetchRoutes([
      { url: '/api/v1/insights/overview', body: { data: overview } },
      { url: '/api/v1/insights/growth', body: { data: [] } },
      { url: '/api/v1/insights/streaks', body: { data: streaks } },
      { url: '/api/v1/insights/stale', body: { data: [] } },
      { url: '/api/v1/insights/suggested-links', body: { data: [] } },
      { url: '/api/v1/insights/reading', body: { data: [] } },
      { url: '/api/v1/insights/dead-ends', body: { data: [] } },
      {
        url: '/api/v1/insights/health',
        body: {
          data: {
            score: 85,
            checklist: [
              { id: 'orphans', label: 'No orphan notes', ok: false },
              { id: 'links', label: 'Good link density', ok: true },
            ],
          },
        },
      },
    ]);

    render(<InsightsPage />, { wrapper: createWrapper(['/insights']) });

    await waitFor(() => expect(screen.getByText('85')).toBeDefined(), { timeout: 3000 });
    expect(screen.getByText('No orphan notes')).toBeDefined();
    expect(screen.getByText('Good link density')).toBeDefined();
  });
});
