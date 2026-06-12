// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWrapper, mockFetchRoutes } from '../test-utils/wrappers.js';
import { QueryBar, downloadText } from './QueryBar.js';

afterEach(() => vi.unstubAllGlobals());

/** Controlled harness so onChange/value behave like in NotesPage. */
function Harness({
  onRun = () => {},
  activeQuery = null,
  warnings = [],
  error = null,
}: {
  onRun?: (q: string) => void;
  activeQuery?: string | null;
  warnings?: string[];
  error?: string | null;
}) {
  const [value, setValue] = useState('');
  return (
    <QueryBar
      value={value}
      onChange={setValue}
      onRun={onRun}
      activeQuery={activeQuery}
      warnings={warnings}
      error={error}
    />
  );
}

const type = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value, selectionStart: value.length } });
};

describe('FQL query bar (F278)', () => {
  it('highlights tokens in the mirror layer', () => {
    const { container } = render(<Harness />, { wrapper: createWrapper() });
    type(screen.getByLabelText('FQL query'), 'tag:fox AND moral');
    expect(container.querySelector('.fql-tok--field')?.textContent).toBe('tag:');
    expect(container.querySelector('.fql-tok--value')?.textContent).toBe('fox');
    expect(container.querySelector('.fql-tok--operator')?.textContent).toBe('AND');
  });

  it('completes field names and keeps typing flowing', () => {
    render(<Harness />, { wrapper: createWrapper() });
    const input = screen.getByLabelText('FQL query');
    type(input, 'noteb');
    const option = screen.getByRole('option', { name: /notebook:/ });
    fireEvent.mouseDown(option);
    expect((input as HTMLInputElement).value).toBe('notebook:');
  });

  it('applies the selected completion with Enter and runs the query on the next Enter', () => {
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />, { wrapper: createWrapper() });
    const input = screen.getByLabelText('FQL query');
    type(input, 'pin');
    fireEvent.keyDown(input, { key: 'Enter' }); // applies "pinned:"
    expect((input as HTMLInputElement).value).toBe('pinned:');
    expect(onRun).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' }); // no completion open → runs
    expect(onRun).toHaveBeenCalledWith('pinned:');
  });

  it('runs the trimmed query on Enter', () => {
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />, { wrapper: createWrapper() });
    const input = screen.getByLabelText('FQL query');
    fireEvent.change(input, { target: { value: '  tag:fox  ', selectionStart: 4 } });
    fireEvent.keyDown(input, { key: 'Escape' }); // close any completion
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRun).toHaveBeenCalledWith('tag:fox');
  });
});

describe('warning chips (F279)', () => {
  it('shows partial-result warnings as dismissible chips', () => {
    render(
      <Harness activeQuery="tag:fox bogus:" warnings={['ignored unparseable clause at 8']} />,
      { wrapper: createWrapper() },
    );
    expect(screen.getByText('ignored unparseable clause at 8')).toBeDefined();
    fireEvent.click(screen.getByLabelText(/Dismiss warning/));
    expect(screen.queryByText('ignored unparseable clause at 8')).toBeNull();
  });

  it('shows fatal errors as an error chip', () => {
    render(<Harness error="FQL syntax error: unmatched )" />, { wrapper: createWrapper() });
    expect(screen.getByRole('alert').textContent).toContain('unmatched');
  });
});

describe('result export (F288)', () => {
  it('copies the server-rendered markdown table to the clipboard', async () => {
    mockFetchRoutes([{ url: '/query/export', body: '| Title |\n| --- |\n| Fox |' }]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<Harness activeQuery="tag:fox" />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByLabelText('Copy results as markdown table'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('| Title |\n| --- |\n| Fox |'));
  });

  it('downloads the markdown via a temporary anchor', () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadText('query-results.md', '| Title |');
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});
