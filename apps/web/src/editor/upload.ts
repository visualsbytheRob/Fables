/**
 * Image paste + file drag-and-drop (F127/F128).
 *
 * The editor takes an injected `onUpload` so it stays decoupled from the
 * attachments endpoint (built in the server lane); tests and the demo inject
 * a mock. While the upload runs we insert a visible placeholder, then swap it
 * for the final markdown link.
 */
import { EditorView } from '@uiw/react-codemirror';
import type { Extension } from '@uiw/react-codemirror';

export type UploadHandler = (file: File) => Promise<{ url: string }>;

function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}

function markdownFor(file: File, url: string): string {
  if (isImage(file)) {
    const alt = file.name.replace(/\.[a-z0-9]+$/i, '') || 'image';
    return `![${alt}](${url})`;
  }
  return `[${file.name}](${url})`;
}

let placeholderId = 0;

/** Insert files at `pos`: placeholder first, markdown link once the upload resolves. */
export async function insertFiles(
  view: EditorView,
  files: readonly File[],
  pos: number,
  onUpload: UploadHandler,
): Promise<void> {
  for (const file of files) {
    const placeholder = `![Uploading ${file.name} #${++placeholderId}…]()`;
    const at = Math.min(pos, view.state.doc.length);
    view.dispatch({ changes: { from: at, insert: placeholder }, userEvent: 'input.paste' });
    let replacement = '';
    try {
      const { url } = await onUpload(file);
      replacement = markdownFor(file, url);
    } catch {
      replacement = ''; // upload failed: just remove the placeholder
    }
    // The document may have changed while uploading — find the placeholder again.
    const target = view.state.doc.toString().indexOf(placeholder);
    if (target >= 0) {
      view.dispatch({
        changes: { from: target, to: target + placeholder.length, insert: replacement },
        userEvent: 'input.paste',
      });
    }
  }
}

/** DOM handlers wiring paste/drop events to `insertFiles` (F127/F128). */
export function fileUploadExtension(onUpload: UploadHandler): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = Array.from(event.clipboardData?.files ?? []).filter(isImage);
      if (files.length === 0) return false;
      event.preventDefault();
      void insertFiles(view, files, view.state.selection.main.from, onUpload);
      return true;
    },
    drop(event, view) {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return false;
      event.preventDefault();
      const pos =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from;
      void insertFiles(view, files, pos, onUpload);
      return true;
    },
  });
}
