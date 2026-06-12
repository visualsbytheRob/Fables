// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWrapper, mockFetchRoutes } from '../test-utils/wrappers.js';
import { diffSides, HistoryPanel } from './HistoryPanel.js';

const meta = (rev: number) => ({
  noteId: 'n1',
  rev,
  title: 'T',
  wordCount: rev * 10,
  charCount: rev * 50,
  contentHash: `h${rev}`,
  createdAt: '2026-06-12T00:00:00Z',
});

afterEach(() => vi.unstubAllGlobals());

describe('diffSides (F184)', () => {
  it('splits ops into old (equal+del) and new (equal+add)', () => {
    const ops = [
      { op: 'equal' as const, text: 'the ' },
      { op: 'del' as const, text: 'quick' },
      { op: 'add' as const, text: 'lazy' },
      { op: 'equal' as const, text: ' fox' },
    ];
    expect(diffSides(ops).left.map((o) => o.text)).toEqual(['the ', 'quick', ' fox']);
    expect(diffSides(ops).right.map((o) => o.text)).toEqual(['the ', 'lazy', ' fox']);
  });
});

describe('history panel (F183–F185)', () => {
  it('lists revisions, shows a side-by-side diff, and restores', async () => {
    const { calls } = mockFetchRoutes([
      {
        url: '/revisions/5/diff',
        body: {
          data: {
            noteId: 'n1',
            from: 2,
            to: 5,
            ops: [
              { op: 'equal', text: 'same' },
              { op: 'del', text: 'old' },
              { op: 'add', text: 'new' },
            ],
          },
        },
      },
      {
        method: 'POST',
        url: '/revisions/2/restore',
        body: { data: { id: 'n1', title: 'T', body: 'restored body', rev: 6 } },
      },
      { url: '/notes/n1/revisions', body: { data: [meta(5), meta(2)] } },
    ]);
    const onRestored = vi.fn();
    render(<HistoryPanel noteId="n1" onClose={() => {}} onRestored={onRestored} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(screen.getByText('r5 (latest)')).toBeDefined());

    fireEvent.click(screen.getByText('r2'));
    await waitFor(() => expect(screen.getAllByText('same').length).toBe(2)); // both panes
    expect(screen.getByText('old')).toBeDefined(); // left only
    expect(screen.getByText('new')).toBeDefined(); // right only

    fireEvent.click(screen.getByLabelText('Restore revision 2'));
    await waitFor(() =>
      expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ body: 'restored body' })),
    );
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/revisions/2/restore'))).toBe(
      true,
    );
  });
});
