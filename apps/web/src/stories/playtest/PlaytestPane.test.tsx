// @vitest-environment jsdom
/**
 * Playtest pane integration tests (F540): run, choose, transcript with
 * source attribution, scenario record/replay chips, and the mobile frame.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@fables/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaytestPane } from './PlaytestPane.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const STORY = `-> gate

=== gate ===
The gate creaks.
* Slip through.
  -> garden
+ Wait.
  -> gate

=== garden ===
Moonlight on moss.
-> END
`;

const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

function renderPane(source = STORY, onJumpToSource = vi.fn(), version = 0) {
  const utils = render(
    <PlaytestPane
      storyId="s1"
      sources={new Map([['main.fable', source]])}
      entryPath="main.fable"
      version={version}
      onJumpToSource={onJumpToSource}
    />,
    { wrapper },
  );
  return { ...utils, onJumpToSource };
}

describe('PlaytestPane (F531–F540)', () => {
  it('runs the buffers and plays through choices (F531)', async () => {
    renderPane();
    fireEvent.click(screen.getByText('Run'));

    const transcript = await screen.findByTestId('playtest-transcript');
    await waitFor(() => expect(transcript.textContent).toContain('The gate creaks.'));
    const choice = await screen.findByText('Slip through.');

    fireEvent.click(choice);
    await waitFor(() => expect(transcript.textContent).toContain('Moonlight on moss.'));
    expect(screen.getByText('— THE END —')).toBeTruthy();
  });

  it('attributes transcript lines to their source and jumps on click (F538)', async () => {
    const { onJumpToSource } = renderPane();
    fireEvent.click(screen.getByText('Run'));
    const src = await screen.findByText('main.fable:4');
    fireEvent.click(src);
    expect(onJumpToSource).toHaveBeenCalledWith('main.fable', 4);
  });

  it('records a scenario and the runner reports pass (F536/F537)', async () => {
    renderPane();
    fireEvent.click(screen.getByText('Run'));
    fireEvent.click(await screen.findByText('Slip through.'));
    await waitFor(() => expect(screen.getByTestId('playtest-transcript').textContent).toContain('Moonlight'));

    fireEvent.change(screen.getByLabelText('Scenario name'), { target: { value: 'happy' } });
    fireEvent.click(screen.getByText('Save path'));
    await screen.findByText(/happy · 1 choice/);

    fireEvent.click(screen.getByText('Run all'));
    await screen.findByText('pass');
  });

  it('shows the state editor with declared VARs (F535)', async () => {
    renderPane('VAR cunning = 1\n\n-> a\n\n=== a ===\n{cunning} sly.\n-> END\n');
    fireEvent.click(screen.getByText('vars'));
    const editor = await screen.findByTestId('playtest-vars');
    expect(editor.textContent).toContain('cunning');

    fireEvent.change(screen.getByLabelText('Initial value for cunning'), { target: { value: '9' } });
    fireEvent.click(screen.getByText('Run'));
    await waitFor(() =>
      expect(screen.getByTestId('playtest-transcript').textContent).toContain('9 sly.'),
    );
  });

  it('offers jump-to-knot starts (F534)', async () => {
    renderPane();
    const select = screen.getByLabelText('Start at knot');
    expect(select.textContent).toContain('garden');
    fireEvent.change(select, { target: { value: 'garden' } });
    fireEvent.click(screen.getByText('Run'));
    await waitFor(() => {
      const t = screen.getByTestId('playtest-transcript').textContent ?? '';
      expect(t).toContain('Moonlight on moss.');
      expect(t).not.toContain('The gate creaks.');
    });
  });

  it('wraps the transcript in a phone frame when toggled (F539)', () => {
    renderPane();
    expect(screen.queryByTestId('mobile-frame')).toBeNull();
    fireEvent.click(screen.getByTitle('iPhone preview frame (F539)'));
    expect(screen.getByTestId('mobile-frame')).toBeTruthy();
  });
});
