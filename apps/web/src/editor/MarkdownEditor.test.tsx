// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@fables/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installCodeMirrorDomStubs } from '../test-utils/cm-dom.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { defaultEditorSettings } from './settings.js';

installCodeMirrorDomStubs();

function renderEditor(props: Partial<Parameters<typeof MarkdownEditor>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <ThemeProvider>
      <MarkdownEditor value={props.value ?? ''} onChange={onChange} {...props} />
    </ThemeProvider>,
  );
  return { onChange, ...utils };
}

afterEach(cleanup);

describe('MarkdownEditor (F130)', () => {
  it('mounts CodeMirror with the document', () => {
    const { container } = renderEditor({ value: '# The Fox' });
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    expect(container.textContent).toContain('The Fox');
  });

  it('toolbar bold button dispatches the command through the view', async () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('****', expect.anything()));
  });

  it('toolbar code block button uses the selected language tag', async () => {
    const { onChange } = renderEditor();
    fireEvent.change(screen.getByLabelText('Code block language'), { target: { value: 'rust' } });
    fireEvent.click(screen.getByRole('button', { name: 'Code block' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('```rust\n\n```', expect.anything()));
  });

  it('uploads attached files and inserts markdown image links (F127/F128)', async () => {
    const onUpload = vi.fn().mockResolvedValue({ url: '/attachments/fox.png' });
    const { onChange } = renderEditor({ onUpload });
    const file = new File(['png-bytes'], 'fox.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('md-editor-file-input'), { target: { files: [file] } });
    await waitFor(() => {
      expect(onUpload).toHaveBeenCalledWith(file);
      expect(onChange).toHaveBeenCalledWith('![fox](/attachments/fox.png)', expect.anything());
    });
  });

  it('removes the placeholder when an upload fails', async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error('offline'));
    const { onChange } = renderEditor({ onUpload });
    const file = new File(['x'], 'note.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('md-editor-file-input'), { target: { files: [file] } });
    await waitFor(() => expect(onUpload).toHaveBeenCalled());
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1);
      expect(last?.[0]).toBe('');
    });
  });

  it('applies soft-wrap from settings (F129)', () => {
    const wrapped = renderEditor({
      value: 'long line',
      settings: { ...defaultEditorSettings, softWrap: true },
    });
    expect(wrapped.container.querySelector('.cm-lineWrapping')).not.toBeNull();
    wrapped.unmount();
    const noWrap = renderEditor({
      value: 'long line',
      settings: { ...defaultEditorSettings, softWrap: false },
    });
    expect(noWrap.container.querySelector('.cm-lineWrapping')).toBeNull();
  });
});
