// @vitest-environment jsdom
/**
 * Import progress UI (F297): scan → dry-run report → run → polled job
 * progress with per-file error triage.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportJob } from '../api/client.js';
import { createWrapper, emptyPage, mockFetchRoutes } from '../test-utils/wrappers.js';
import { ImportPage } from './ImportPage.js';

afterEach(() => vi.unstubAllGlobals());

const scanReport = {
  path: '/vault',
  files: [
    { path: 'fables/fox.md', title: 'The Fox', attachments: 2, collision: false },
    { path: 'fables/crow.md', title: 'The Crow', attachments: 0, collision: true },
  ],
  totals: { files: 2, attachments: 2, collisions: 1 },
};

const job = (over: Partial<ImportJob> = {}): ImportJob => ({
  id: 'job_1',
  path: '/vault',
  status: 'running',
  total: 2,
  processed: 0,
  imported: 0,
  merged: 0,
  renamed: 0,
  skipped: 0,
  attachments: 0,
  errors: [],
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
  ...over,
});

const baseRoutes = [
  { url: '/notebooks/tree', body: { data: [] } },
  { url: '/notes?', body: { data: [], page: emptyPage } },
];

describe('import progress UI (F297)', () => {
  it('scans a folder and shows the dry-run report with collisions', async () => {
    const { calls } = mockFetchRoutes([
      ...baseRoutes,
      { url: '/import/scan', method: 'POST', body: { data: scanReport } },
    ]);
    render(<ImportPage />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText('Import path'), { target: { value: '/vault' } });
    fireEvent.click(screen.getByText('Scan (dry run)'));

    await waitFor(() => expect(screen.getByText('Dry-run report')).toBeDefined());
    expect(screen.getByText('fables/fox.md')).toBeDefined();
    expect(screen.getByText('collision')).toBeDefined();
    expect(screen.getByText(/2 files · 2 attachments · 1 title collision/)).toBeDefined();
    const scan = calls.find((c) => c.url.includes('/import/scan'));
    expect(scan?.body).toEqual({ path: '/vault' });
  });

  it('shows a scan error for an invalid path', async () => {
    mockFetchRoutes([
      ...baseRoutes,
      {
        url: '/import/scan',
        method: 'POST',
        status: 400,
        body: { error: { code: 'VALIDATION', message: 'path does not exist', details: null } },
      },
    ]);
    render(<ImportPage />, { wrapper: createWrapper() });
    fireEvent.change(screen.getByLabelText('Import path'), { target: { value: '/nope' } });
    fireEvent.click(screen.getByText('Scan (dry run)'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('path does not exist'),
    );
  });

  it('runs the import and polls job progress through to the error triage list', async () => {
    const finished = job({
      status: 'done',
      processed: 2,
      imported: 1,
      skipped: 0,
      attachments: 2,
      errors: [{ file: 'fables/crow.md', message: 'frontmatter is not valid YAML' }],
    });
    const { calls } = mockFetchRoutes([
      ...baseRoutes,
      { url: '/import/scan', method: 'POST', body: { data: scanReport } },
      { url: '/import/run', method: 'POST', status: 202, body: { data: job() } },
      { url: '/import/jobs/job_1', body: { data: finished } },
    ]);
    render(<ImportPage />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText('Import path'), { target: { value: '/vault' } });
    fireEvent.click(screen.getByText('Scan (dry run)'));
    await waitFor(() => expect(screen.getByText('Dry-run report')).toBeDefined());

    fireEvent.change(screen.getByLabelText('Collision mode'), { target: { value: 'merge' } });
    fireEvent.click(screen.getByText('Import 2 files'));

    await waitFor(() => expect(screen.getByText('Import complete')).toBeDefined());
    expect(screen.getByTestId('import-counters').textContent).toContain('2/2 processed');
    expect(screen.getByTestId('import-counters').textContent).toContain('1 imported');
    expect(screen.getByTestId('import-counters').textContent).toContain('2 attachments');

    // Error triage list (per-file failures).
    expect(screen.getByLabelText('Import errors').textContent).toContain('fables/crow.md');
    expect(screen.getByLabelText('Import errors').textContent).toContain(
      'frontmatter is not valid YAML',
    );

    const run = calls.find((c) => c.url.includes('/import/run'));
    expect(run?.body).toEqual({ path: '/vault', collisions: 'merge' });
  });
});
