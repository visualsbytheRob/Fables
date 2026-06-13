// @vitest-environment jsdom
/**
 * History, bookmarks, transcript and comparison integration tests
 * (F561–F566, F569, F570) on the live player.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWrapper, mockFetchRoutes, type FetchRoute } from '../test-utils/wrappers.js';
import { DEFAULT_PREFS, loadBookmarks, recordPlaythrough, savePrefs } from './prefs.js';
import { PlayerPage } from './PlayerPage.js';

const SOURCE = `# title: Loop

-> gate

=== gate ===
The gate creaks.
+ Wait by the wall.
  Dust settles.
  -> gate
* Slip through.
  -> garden

=== garden ===
Moonlight on moss. # ending: moss
-> END
`;

const story = {
  id: 's1',
  title: 'Loop',
  description: '',
  entryFile: 'main.fable',
  status: 'valid',
  settings: { cover: { color: null, emoji: null }, theme: null, seedMode: 'fixed', seed: 5 },
  createdAt: '',
  updatedAt: '2026-06-13T00:00:00Z',
};
const fileMeta = { id: 'f1', storyId: 's1', path: 'main.fable', createdAt: '', updatedAt: '' };

function routes(extra: FetchRoute[] = []): FetchRoute[] {
  return [
    ...extra,
    { url: '/saves?kind=auto', body: { data: [] } },
    { url: '/saves?kind=slot', body: { data: [] } },
    {
      method: 'POST',
      url: '/saves',
      body: { data: { id: 'slot1', name: '🔖 x', turn: 1, scene: 'gate' } },
      status: 201,
    },
    { method: 'PUT', url: '/autosave', body: { data: { save: { id: 'a1' }, retained: 1 } } },
    { url: '/files/f1', body: { data: { ...fileMeta, source: SOURCE } } },
    { url: '/files', body: { data: [fileMeta] } },
    { url: '/notebooks', body: { data: [{ id: 'nb1', name: 'Inbox' }] } },
    { method: 'POST', url: '/notes', body: { data: { id: 'n1' } }, status: 201 },
    { url: '/stories/s1', body: { data: story } },
  ];
}

function renderPlayer() {
  return render(
    <Routes>
      <Route path="/stories/:storyId/play" element={<PlayerPage />} />
    </Routes>,
    { wrapper: createWrapper(['/stories/s1/play']) },
  );
}

async function playTwoWaits() {
  fireEvent.click(await screen.findByRole('button', { name: 'Wait by the wall.' }));
  await waitFor(() => expect(screen.getAllByText('Dust settles.')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Wait by the wall.' }));
  await waitFor(() => expect(screen.getAllByText('Dust settles.')).toHaveLength(2));
}

beforeEach(() => savePrefs({ ...DEFAULT_PREFS, pacing: 'instant' }));
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('history & rewind (F561/F562)', () => {
  it('lists every choice and rewinds deterministically', async () => {
    mockFetchRoutes(routes());
    renderPlayer();
    await playTwoWaits();

    fireEvent.click(screen.getByRole('button', { name: 'Player menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choice history' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choice history' });
    expect(dialog.textContent).toContain('turn 0');
    expect(dialog.textContent).toContain('turn 1');

    // Rewind to before the first wait: no "Dust settles." remains.
    fireEvent.click(screen.getAllByRole('button', { name: /Rewind to before/ })[0] as HTMLElement);
    await waitFor(() => expect(screen.queryAllByText('Dust settles.')).toHaveLength(0));
    expect(screen.getAllByText('The gate creaks.')).toHaveLength(1);
  });
});

describe('bookmarks (F563/F564)', () => {
  it('saves a bookmark slot with a note and lists it', async () => {
    const { calls } = mockFetchRoutes(routes());
    renderPlayer();
    await playTwoWaits();

    fireEvent.click(screen.getByRole('button', { name: 'Player menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bookmarks' }));
    fireEvent.change(await screen.findByLabelText('Bookmark note'), {
      target: { value: 'before the duel' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Bookmark$/ }));

    await waitFor(() => expect(loadBookmarks('s1')).toHaveLength(1));
    expect(loadBookmarks('s1')[0]?.saveId).toBe('slot1');
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/saves'));
    expect(post).toBeTruthy();
    expect((post?.body as { name: string }).name).toContain('before the duel');
    expect(screen.getByText('before the duel')).toBeTruthy();
  });
});

describe('transcript reader + note export (F565/F566)', () => {
  it('shows the continuous transcript and posts it as a note', async () => {
    const { calls } = mockFetchRoutes(routes());
    renderPlayer();
    await playTwoWaits();

    fireEvent.click(screen.getByRole('button', { name: 'Player menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    const reader = await screen.findByTestId('player-transcript');
    expect(reader.textContent).toContain('The gate creaks.');
    expect(reader.textContent).toContain('➤ Wait by the wall.');

    fireEvent.click(screen.getByRole('button', { name: 'Save as note' }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.includes('/notes'));
      expect(post).toBeTruthy();
      const body = post?.body as { title: string; body: string; notebookId: string };
      expect(body.title).toMatch(/^Transcript: Loop — \d{4}-\d{2}-\d{2}$/);
      expect(body.notebookId).toBe('nb1');
      expect(body.body).toContain('The gate creaks.');
    });
  });
});

describe('playthrough comparison (F569)', () => {
  it('diffs two stored transcripts side by side', async () => {
    recordPlaythrough('s1', {
      endedAt: '2026-06-12T00:00:00Z',
      ending: 'moss',
      transcript: 'The gate creaks.\n> Slip through.\nMoonlight on moss.',
    });
    recordPlaythrough('s1', {
      endedAt: '2026-06-13T00:00:00Z',
      ending: 'moss',
      transcript: 'The gate creaks.\n> Wait by the wall.\nDust settles.',
    });
    mockFetchRoutes(routes());
    renderPlayer();
    await screen.findByText('The gate creaks.');

    fireEvent.click(screen.getByRole('button', { name: 'Player menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare playthroughs' }));
    const compare = await screen.findByTestId('player-compare');
    expect(compare.querySelectorAll('.cmp-line.del').length).toBeGreaterThan(0);
    expect(compare.querySelectorAll('.cmp-line.add').length).toBeGreaterThan(0);
    expect(compare.textContent).toContain('Moonlight on moss.');
    expect(compare.textContent).toContain('Dust settles.');
  });
});
