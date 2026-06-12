// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWrapper, mockFetchRoutes } from '../test-utils/wrappers.js';
import { saveDefaultNotebook } from './prefs.js';
import { QuickCapture } from './QuickCapture.js';

const treeNode = (id: string, name: string) => ({
  id,
  parentId: null,
  name,
  icon: null,
  color: null,
  archived: false,
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
  noteCount: 0,
  children: [],
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('quick capture (F191/F145)', () => {
  it('opens on Mod-Shift-N and posts into the default notebook', async () => {
    saveDefaultNotebook('nb2');
    const { calls } = mockFetchRoutes([
      {
        url: '/notebooks/tree',
        body: { data: [treeNode('nb1', 'Inbox'), treeNode('nb2', 'Journal')] },
      },
      {
        method: 'POST',
        url: '/notes',
        status: 201,
        body: { data: { id: 'new1', notebookId: 'nb2', title: 'Hello', body: '', rev: 0 } },
      },
    ]);
    const onCreated = vi.fn();
    render(<QuickCapture onCreated={onCreated} />, { wrapper: createWrapper() });

    expect(screen.queryByText('Quick capture')).toBeNull();
    fireEvent.keyDown(window, { key: 'N', ctrlKey: true, shiftKey: true });
    expect(screen.getByText('Quick capture')).toBeDefined();

    await waitFor(() => expect(screen.getByText('Journal')).toBeDefined());
    // default notebook preselected (F145)
    expect((screen.getByLabelText('Capture notebook') as HTMLSelectElement).value).toBe('nb2');

    fireEvent.change(screen.getByLabelText('Capture text'), {
      target: { value: 'Hello\nbody line' },
    });
    fireEvent.click(screen.getByText(/Capture \(/));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new1'));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toMatchObject({ notebookId: 'nb2', title: 'Hello', body: 'body line' });
  });
});
