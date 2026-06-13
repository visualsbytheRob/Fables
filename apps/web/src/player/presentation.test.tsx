// @vitest-environment jsdom
/**
 * Presentation snapshot tests (F551–F560): theme token scoping, text-size
 * controls, paragraph effects, scene backdrops and the theme gallery.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWrapper, mockFetchRoutes } from '../test-utils/wrappers.js';
import { DEFAULT_PREFS, PLAYER_THEMES, savePrefs } from './prefs.js';
import { PlayerPage } from './PlayerPage.js';

const SOURCE = `# title: Themes

-> cavern

=== cavern ===
Dripping dark. # scene: cave # chapter: Below
A whisper coils. # whisper
The walls TREMBLE. # shake
It matters. # emphasis
* Press on.
  -> END
`;

const story = {
  id: 's1',
  title: 'Themes',
  description: '',
  entryFile: 'main.fable',
  status: 'valid',
  settings: { cover: { color: null, emoji: null }, theme: null, seedMode: 'fixed', seed: 1 },
  createdAt: '',
  updatedAt: '',
};
const fileMeta = { id: 'f1', storyId: 's1', path: 'main.fable', createdAt: '', updatedAt: '' };

function install(themeOverride: string | null = null) {
  mockFetchRoutes([
    { url: '/saves?kind=auto', body: { data: [] } },
    { method: 'PUT', url: '/autosave', body: { data: { save: { id: 'a1' }, retained: 1 } } },
    { url: '/files/f1', body: { data: { ...fileMeta, source: SOURCE } } },
    { url: '/files', body: { data: [fileMeta] } },
    { url: '/stories/s1', body: { data: { ...story, settings: { ...story.settings, theme: themeOverride } } } },
  ]);
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

describe('player presentation (F551–F560)', () => {
  for (const theme of PLAYER_THEMES) {
    it(`renders the ${theme} theme surface (F551)`, async () => {
      savePrefs({ ...DEFAULT_PREFS, pacing: 'instant', theme });
      install();
      renderPlayer();
      await screen.findByText('A whisper coils.');
      const surface = screen.getByTestId('player-surface');
      expect(surface.getAttribute('data-player-theme')).toBe(theme);
      expect(screen.getByTestId('player-stream')).toMatchSnapshot();
    });
  }

  it('honours the per-story theme override (F552)', async () => {
    savePrefs({ ...DEFAULT_PREFS, pacing: 'instant', theme: 'serif' });
    install('terminal');
    renderPlayer();
    await screen.findByText('A whisper coils.');
    expect(screen.getByTestId('player-surface').getAttribute('data-player-theme')).toBe('terminal');
  });

  it('applies text size and line-height prefs to the stream (F553)', async () => {
    savePrefs({ ...DEFAULT_PREFS, pacing: 'instant', textSize: 22, lineHeight: 1.9 });
    install();
    renderPlayer();
    await screen.findByText('A whisper coils.');
    const style = screen.getByTestId('player-surface').getAttribute('style') ?? '';
    expect(style).toContain('--pl-size: 22px');
    expect(style).toContain('--pl-leading: 1.9');
  });

  it('maps scene tags onto the backdrop hue (F555)', async () => {
    install();
    renderPlayer();
    await screen.findByText('A whisper coils.');
    const surface = screen.getByTestId('player-surface');
    expect(surface.getAttribute('data-scene')).toBe('cave');
    expect(surface.getAttribute('style')).toContain('--pl-scene-hue: 270');
  });

  it('shows the theme gallery with live-preview swatches (F559)', async () => {
    install();
    renderPlayer();
    await screen.findByText('A whisper coils.');
    fireEvent.click(screen.getByRole('button', { name: 'Player menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reader settings' }));

    const gallery = await screen.findByRole('group', { name: 'Theme gallery' });
    const swatches = gallery.querySelectorAll('.player-theme-swatch');
    expect(swatches).toHaveLength(4);
    // Each swatch previews its own token set via the scoped theme attribute.
    expect([...swatches].map((s) => s.getAttribute('data-player-theme'))).toEqual([
      'serif',
      'parchment',
      'terminal',
      'dark',
    ]);
    fireEvent.click(swatches[2] as HTMLElement);
    expect(screen.getByTestId('player-surface').getAttribute('data-player-theme')).toBe('terminal');
  });
});
