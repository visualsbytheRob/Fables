// @vitest-environment jsdom
/**
 * Ingestion queue UI (F766, F769).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IngestJob } from '../api/client.js';
import { createWrapper, mockFetchRoutes } from '../test-utils/wrappers.js';
import { IngestPage } from './IngestPage.js';

afterEach(() => vi.unstubAllGlobals());

const makeJob = (over: Partial<IngestJob> = {}): IngestJob => ({
  id: 'job_1',
  sourceType: 'pdf',
  status: 'done',
  progress: 100,
  error: null,
  noteId: 'note_abc',
  createdAt: new Date().toISOString(),
  ...over,
});

const baseRoutes = [{ url: '/ingest/jobs', body: { data: [] } }];

describe('ingestion queue UI (F766)', () => {
  it('renders the drop zone and URL input', () => {
    mockFetchRoutes(baseRoutes);
    render(<IngestPage />, { wrapper: createWrapper() });
    expect(screen.getByRole('button', { name: /drop zone/i })).toBeDefined();
    expect(screen.getByLabelText('URL to ingest')).toBeDefined();
    expect(screen.getByText('Ingest URL')).toBeDefined();
  });

  it('disables Ingest URL when input is empty', () => {
    mockFetchRoutes(baseRoutes);
    render(<IngestPage />, { wrapper: createWrapper() });
    const btn = screen.getByText('Ingest URL').closest('button')!;
    expect(btn.disabled).toBe(true);
  });

  it('submits a URL and shows the queue', async () => {
    const { calls } = mockFetchRoutes([
      { url: '/ingest/jobs', body: { data: [] } },
      {
        url: '/ingest',
        method: 'POST',
        body: { data: { jobId: 'job_1' } },
      },
      { url: '/ingest/jobs', body: { data: [makeJob()] } },
    ]);
    render(<IngestPage />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText('URL to ingest'), {
      target: { value: 'https://example.com/doc.pdf' },
    });
    fireEvent.click(screen.getByText('Ingest URL'));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/ingest') && c.method === 'POST')).toBe(true),
    );
  });

  it('shows running jobs from the queue', async () => {
    const runningJob = makeJob({ status: 'running', progress: 42, noteId: null });
    mockFetchRoutes([{ url: '/ingest/jobs', body: { data: [runningJob] } }]);
    render(<IngestPage />, { wrapper: createWrapper() });

    // Wait for the badge that shows the source type to appear
    await waitFor(() => expect(screen.getByLabelText('Ingestion queue')).toBeDefined());
    // The source type badge is rendered for each job
    await waitFor(() => expect(screen.getAllByText('pdf').length).toBeGreaterThan(0));
  });

  it('shows a link to the created note when done', async () => {
    const doneJob = makeJob({ status: 'done', noteId: 'note_xyz' });
    mockFetchRoutes([{ url: '/ingest/jobs', body: { data: [doneJob] } }]);
    render(<IngestPage />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText('Open created note')).toBeDefined());
  });

  it('shows an error for failed jobs', async () => {
    const failedJob = makeJob({ status: 'failed', error: 'Parse error', noteId: null });
    mockFetchRoutes([{ url: '/ingest/jobs', body: { data: [failedJob] } }]);
    render(<IngestPage />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Parse error'));
  });

  it('rejects unsupported file types on drop (F769)', async () => {
    // Toast should fire for an unsupported extension.
    const { calls } = mockFetchRoutes(baseRoutes);
    render(<IngestPage />, { wrapper: createWrapper() });

    const dropzone = screen.getByRole('button', { name: /drop zone/i });
    const file = new File(['data'], 'doc.txt', { type: 'text/plain' });
    const dt = { files: [file], types: ['Files'] };
    fireEvent.drop(dropzone, { dataTransfer: dt });

    // No POST /ingest should have been made for an unsupported file.
    const ingestPosts = calls.filter((c) => c.method === 'POST' && c.url.includes('/ingest'));
    expect(ingestPosts).toHaveLength(0);
  });
});
