// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteWithTags } from '../api/client.js';
import { mockFetchRoutes, type FetchRoute } from '../test-utils/wrappers.js';
import { loadDraft } from './drafts.js';
import { AUTOSAVE_DELAY_MS, useAutosave } from './useAutosave.js';

const note = (over: Partial<NoteWithTags> = {}): NoteWithTags => ({
  id: 'n1',
  notebookId: 'nb1',
  title: 'Title',
  body: 'original',
  pinned: false,
  trashedAt: null,
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
  rev: 3,
  tags: [],
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAutosave (F181/F182/F186/F189)', () => {
  it('debounces edits into a PATCH with the tracked rev and clears the draft', async () => {
    const { calls } = mockFetchRoutes([
      { method: 'PATCH', url: '/notes/n1', body: { data: note({ rev: 4, body: 'edited' }) } },
    ]);
    const { result } = renderHook(() => useAutosave(note()));

    act(() => result.current.onEdit({ title: 'Title', body: 'edited' }));
    expect(result.current.status).toBe('dirty');
    expect(loadDraft('n1')?.body).toBe('edited'); // mirror for crash recovery
    expect(calls).toHaveLength(0); // not yet — debounced

    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      body: { rev: 3, title: 'Title', body: 'edited' },
    });
    expect(result.current.status).toBe('saved');
    expect(loadDraft('n1')).toBeNull();

    // Next save uses the bumped rev from the response.
    act(() => result.current.onEdit({ title: 'Title', body: 'edited more' }));
    await act(() => result.current.flush());
    expect(calls[1]?.body).toMatchObject({ rev: 4, body: 'edited more' });
  });

  it('enters conflict state on 409 and resolves both ways', async () => {
    const routes: FetchRoute[] = [
      {
        method: 'PATCH',
        url: '/notes/n1',
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'rev mismatch', details: null } },
      },
      {
        url: '/notes/n1',
        body: { data: note({ rev: 9, body: 'server version' }) },
      },
    ];
    const { calls } = mockFetchRoutes(routes);
    const { result } = renderHook(() => useAutosave(note()));

    act(() => result.current.onEdit({ title: 'Title', body: 'mine' }));
    await act(() => result.current.flush());

    expect(result.current.status).toBe('conflict');
    expect(result.current.conflict?.rev).toBe(9);
    expect(result.current.conflict?.body).toBe('server version');

    // keep mine: re-based on the server rev, then overwrites
    routes[0] = {
      method: 'PATCH',
      url: '/notes/n1',
      body: { data: note({ rev: 10, body: 'mine' }) },
    };
    await act(() => result.current.keepMine());
    const last = calls[calls.length - 1];
    expect(last).toMatchObject({ method: 'PATCH', body: { rev: 9, body: 'mine' } });
    expect(result.current.status).toBe('saved');
  });

  it('acceptTheirs drops local edits and the conflict', async () => {
    mockFetchRoutes([
      {
        method: 'PATCH',
        url: '/notes/n1',
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'rev mismatch', details: null } },
      },
      { url: '/notes/n1', body: { data: note({ rev: 7, body: 'theirs' }) } },
    ]);
    const { result } = renderHook(() => useAutosave(note()));
    act(() => result.current.onEdit({ title: 'Title', body: 'mine' }));
    await act(() => result.current.flush());
    expect(result.current.status).toBe('conflict');

    act(() => result.current.acceptTheirs());
    expect(result.current.conflict).toBeNull();
    expect(result.current.isDirty()).toBe(false);
    expect(loadDraft('n1')).toBeNull();
  });

  it('marks save errors without losing the pending edit', async () => {
    mockFetchRoutes([
      {
        method: 'PATCH',
        url: '/notes/n1',
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'boom', details: null } },
      },
    ]);
    const { result } = renderHook(() => useAutosave(note()));
    act(() => result.current.onEdit({ title: 'Title', body: 'mine' }));
    await act(() => result.current.flush());
    expect(result.current.status).toBe('error');
    expect(result.current.isDirty()).toBe(true);
  });
});
