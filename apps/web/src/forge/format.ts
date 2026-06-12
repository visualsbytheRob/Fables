/**
 * Format-on-save wiring (F378): Mod-S runs the package formatter over the
 * document, applies the canonical text as a single change, then hands the
 * formatted text to the host's save callback. Sources with syntax errors are
 * saved untouched (the formatter guarantees `formatted === source` there).
 */
import { keymap } from '@uiw/react-codemirror';
import type { EditorView, Extension } from '@uiw/react-codemirror';
import { format, type FormatConfig } from '@fables/forge-dsl';

export interface FormatApplication {
  readonly formatted: string;
  readonly changed: boolean;
}

/** Format the document in place. Returns what the document now contains. */
export function applyFormat(view: EditorView, config?: FormatConfig): FormatApplication {
  const source = view.state.doc.toString();
  const result = format(source, config ?? {});
  if (!result.changed) return { formatted: source, changed: false };
  const head = view.state.selection.main.head;
  view.dispatch({
    changes: { from: 0, to: source.length, insert: result.formatted },
    selection: { anchor: Math.min(head, result.formatted.length) },
    scrollIntoView: true,
  });
  return { formatted: result.formatted, changed: true };
}

export const formatDocument = (view: EditorView): boolean => {
  applyFormat(view);
  return true;
};

export interface FormatOnSaveOptions {
  /** Called with the (possibly reformatted) document text after Mod-S. */
  onSave?: (text: string) => void;
  /** Set false to save without reformatting. Default true. */
  formatOnSave?: boolean;
  config?: FormatConfig;
}

export function forgeFormatOnSave(options: FormatOnSaveOptions = {}): Extension {
  const { onSave, formatOnSave = true, config } = options;
  return keymap.of([
    {
      key: 'Mod-s',
      preventDefault: true,
      run: (view) => {
        const text = formatOnSave ? applyFormat(view, config).formatted : view.state.doc.toString();
        onSave?.(text);
        return true;
      },
    },
    { key: 'Shift-Alt-f', preventDefault: true, run: formatDocument },
  ]);
}
