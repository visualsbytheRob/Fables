// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, downloadMarkdown, noteToMarkdown } from './exporters.js';

afterEach(() => vi.unstubAllGlobals());

describe('note export (F195/F196)', () => {
  it('prefixes the title as H1 unless already present', () => {
    expect(noteToMarkdown({ title: 'Fox', body: 'Body text' })).toBe('# Fox\n\nBody text');
    expect(noteToMarkdown({ title: 'Fox', body: '# Fox\n\nBody' })).toBe('# Fox\n\nBody');
    expect(noteToMarkdown({ title: '', body: 'Body' })).toBe('Body');
  });

  it('downloads via a temporary anchor with a safe filename', () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { filename } = downloadMarkdown({ title: 'My: Note', body: 'hello' });
    expect(filename).toBe('My Note.md');
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('copies markdown to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await copyText('# hello');
    expect(writeText).toHaveBeenCalledWith('# hello');
  });
});
