// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SplitView } from './SplitView.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

describe('SplitView (F139)', () => {
  it('renders both panes side by side on desktop', () => {
    stubMatchMedia(false);
    const { container } = render(<SplitView editor={<p>editor</p>} preview={<p>preview</p>} />);
    expect(container.querySelector('.md-split__pane--editor')?.textContent).toBe('editor');
    expect(container.querySelector('.md-split__pane--preview')?.textContent).toBe('preview');
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('falls back to Write/Preview tabs on phone widths, keeping panes mounted', () => {
    stubMatchMedia(true);
    const { container } = render(<SplitView editor={<p>editor</p>} preview={<p>preview</p>} />);
    expect(container.className).toBe('');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(container.firstElementChild?.className).toContain('md-split--tab-write');
    fireEvent.click(screen.getByRole('tab', { name: /preview/i }));
    expect(container.firstElementChild?.className).toContain('md-split--tab-preview');
    // both panes stay mounted so editor state survives switching
    expect(container.querySelector('.md-split__pane--editor')).not.toBeNull();
  });

  it('syncs preview scroll proportionally from the editor pane', () => {
    stubMatchMedia(false);
    const { container } = render(
      <SplitView editor={<div className="cm-scroller">e</div>} preview={<p>p</p>} />,
    );
    const scroller = container.querySelector<HTMLElement>('.cm-scroller')!;
    const right = container.querySelector<HTMLElement>('.md-split__pane--preview')!;
    // jsdom has no layout: define scroll metrics by hand
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 200 },
      scrollTop: { value: 400, writable: true },
    });
    Object.defineProperties(right, {
      scrollHeight: { value: 500 },
      clientHeight: { value: 100 },
      scrollTop: { value: 0, writable: true },
    });
    fireEvent.scroll(scroller);
    // 400/800 = 50% → 50% of 400 = 200
    expect(right.scrollTop).toBe(200);
  });
});
