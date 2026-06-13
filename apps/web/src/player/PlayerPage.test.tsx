// @vitest-environment jsdom
/**
 * Player core e2e on a fixture story (F550): fresh-start flow, choices,
 * autosave-on-choice, continue-from-autosave, stat bars, runtime/compile
 * error handling and the end screen with endings + branch explorer.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWrapper, mockFetchRoutes, type FetchRoute } from '../test-utils/wrappers.js';
import { chooseAndContinue, compileForPlay, startSession } from './engine.js';
import { DEFAULT_PREFS, loadEndings, savePrefs } from './prefs.js';
import { PlayerPage } from './PlayerPage.js';

const SOURCE = `# title: Fixture
# stat: health / 10

VAR health = 7

-> gate

=== gate ===
The gate creaks. # scene: forest
* Slip through.
  -> garden
+ Wait by the wall.
  -> gate

=== garden ===
Chapter two begins. # chapter: Two
Moonlight on moss. # ending: moss
-> END
`;

const story = {
  id: 's1',
  title: 'Fixture',
  description: 'A test fable.',
  entryFile: 'main.fable',
  status: 'valid',
  settings: { cover: { color: null, emoji: null }, theme: null, seedMode: 'fixed', seed: 42 },
  createdAt: '2026-06-13T00:00:00Z',
  updatedAt: '2026-06-13T00:00:00Z',
};
const fileMeta = { id: 'f1', storyId: 's1', path: 'main.fable', createdAt: '', updatedAt: '' };
const file = { ...fileMeta, source: SOURCE };

function routes(extra: FetchRoute[] = [], autos: unknown[] = []): FetchRoute[] {
  return [
    ...extra,
    { url: '/saves?kind=auto', body: { data: autos } },
    { url: '/saves?kind=slot', body: { data: [] } },
    { method: 'PUT', url: '/autosave', body: { data: { save: { id: 'a1' }, retained: 1 } } },
    { url: '/files/f1', body: { data: file } },
    { url: '/files', body: { data: [fileMeta] } },
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

beforeEach(() => savePrefs({ ...DEFAULT_PREFS, pacing: 'instant' }));
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('player core (F541–F550)', () => {
  it('starts fresh, renders prose, takes choices and autosaves (F541/F543/F549)', async () => {
    const { calls } = mockFetchRoutes(routes());
    renderPlayer();

    await screen.findByText('The gate creaks.');
    // Choices are real buttons sized for thumbs (F543/F599).
    const choice = screen.getByRole('button', { name: 'Slip through.' });
    expect(choice.className).toBe('player-choice');

    fireEvent.click(choice);
    await screen.findByText('Moonlight on moss.');
    // The taken choice echoes into the stream and position autosaved (F549).
    expect(screen.getByText('Slip through.').className).toContain('player-echo');
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/autosave'))).toBe(true),
    );
  });

  it('renders stat bars bound to story variables (F546)', async () => {
    mockFetchRoutes(routes());
    renderPlayer();
    const stats = await screen.findByTestId('player-stats');
    expect(stats.textContent).toContain('health');
    expect(stats.textContent).toContain('7');
  });

  it('shows chapter title cards and the scene backdrop attribute (F555/F556)', async () => {
    mockFetchRoutes(routes());
    renderPlayer();
    await screen.findByText('The gate creaks.');
    expect(screen.getByTestId('player-surface').getAttribute('data-scene')).toBe('forest');

    fireEvent.click(screen.getByRole('button', { name: 'Slip through.' }));
    const chapter = await screen.findByText('Two');
    expect(chapter.className).toContain('player-chapter');
  });

  it('offers continue-from-autosave and restores the playthrough (F544)', async () => {
    // Build a real autosave state by playing the same fixture ahead of time.
    const program = compileForPlay(new Map([['main.fable', SOURCE]]), 'main.fable').program!;
    const played = startSession(program, 42);
    chooseAndContinue(played, 1); // wait once
    const save = {
      id: 'sv1',
      storyId: 's1',
      kind: 'auto',
      name: '',
      turn: 1,
      scene: 'gate',
      createdAt: '',
      updatedAt: '',
    };
    mockFetchRoutes(
      routes([{ url: '/saves/sv1', body: { data: { ...save, state: played.saveState() } } }], [save]),
    );
    renderPlayer();

    fireEvent.click(await screen.findByText('Continue where you left off'));
    await screen.findByTestId('player-choices');
    // Restored transcript shows both visits to the gate.
    expect(screen.getAllByText('The gate creaks.')).toHaveLength(2);
  });

  it('finishes with the end screen, endings collection and knot progress (F567/F568)', async () => {
    mockFetchRoutes(routes());
    renderPlayer();
    fireEvent.click(await screen.findByRole('button', { name: 'Slip through.' }));

    const end = await screen.findByTestId('player-end');
    expect(end.textContent).toContain('The End');
    expect(end.textContent).toContain('“moss”');
    expect(end.textContent).toContain('2 of 2 scenes — 100%');
    await waitFor(() => expect(loadEndings('s1').map((e) => e.id)).toEqual(['moss']));
  });

  it('gates broken builds with a friendly screen (F548)', async () => {
    mockFetchRoutes(
      routes([
        { url: '/files/f1', body: { data: { ...file, source: '-> nowhere\n' } } },
      ]),
    );
    renderPlayer();
    await screen.findByText(/does not compile yet/);
    expect(screen.getByRole('button', { name: 'Open editor' })).toBeTruthy();
  });

  it('renders inline attachment images in prose (F547)', async () => {
    mockFetchRoutes(
      routes([
        {
          url: '/files/f1',
          body: {
            data: {
              ...file,
              source: 'A map: ![the map](/api/v1/attachments/abc)\n-> END\n',
            },
          },
        },
      ]),
    );
    renderPlayer();
    const img = await screen.findByAltText('the map');
    expect(img.getAttribute('src')).toBe('/api/v1/attachments/abc');
  });
});
