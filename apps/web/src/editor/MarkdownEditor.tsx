/**
 * MarkdownEditor (F121–F129): CodeMirror 6 markdown editor with toolbar,
 * keyboard shortcuts, smart lists, fenced code blocks with nested highlighting,
 * image paste / file drop, and caller-persisted settings.
 */
import { useMemo, useRef } from 'react';
import CodeMirror, { EditorView, Prec, keymap } from '@uiw/react-codemirror';
import type { Extension, ReactCodeMirrorRef, StateCommand } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import {
  Bold,
  Code,
  Heading,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  useTheme,
} from '@fables/ui';
import {
  cycleHeading,
  editorKeymap,
  insertCodeBlock,
  insertLink,
  toggleBold,
  toggleBulletList,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleQuote,
} from './commands.js';
import { fileUploadExtension, insertFiles, type UploadHandler } from './upload.js';
import { defaultEditorSettings, type EditorSettings } from './settings.js';
import './editor.css';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  settings?: EditorSettings;
  /** Injected attachment uploader (F127/F128) — the endpoint lands in the server lane. */
  onUpload?: UploadHandler;
  placeholder?: string;
  autoFocus?: boolean;
  /** Caller-supplied extensions (tag autocomplete, extra keymaps — F153/F189). */
  extraExtensions?: Extension[];
}

const CODE_BLOCK_LANGUAGES = ['', 'js', 'ts', 'python', 'rust', 'sql', 'bash', 'json', 'css'];

interface ToolbarAction {
  id: string;
  label: string;
  shortcut: string;
  icon: typeof Bold;
  command: StateCommand;
}

const TOOLBAR: ToolbarAction[] = [
  { id: 'bold', label: 'Bold', shortcut: 'Mod-B', icon: Bold, command: toggleBold },
  { id: 'italic', label: 'Italic', shortcut: 'Mod-I', icon: Italic, command: toggleItalic },
  {
    id: 'heading',
    label: 'Heading',
    shortcut: 'Mod-Shift-H',
    icon: Heading,
    command: cycleHeading,
  },
  {
    id: 'bullet-list',
    label: 'Bullet list',
    shortcut: 'Mod-Shift-8',
    icon: List,
    command: toggleBulletList,
  },
  {
    id: 'ordered-list',
    label: 'Numbered list',
    shortcut: 'Mod-Shift-7',
    icon: ListOrdered,
    command: toggleOrderedList,
  },
  { id: 'code', label: 'Inline code', shortcut: 'Mod-E', icon: Code, command: toggleInlineCode },
  { id: 'link', label: 'Link', shortcut: 'Mod-K', icon: Link2, command: insertLink },
  { id: 'quote', label: 'Quote', shortcut: 'Mod-Shift-9', icon: Quote, command: toggleQuote },
];

export function MarkdownEditor({
  value,
  onChange,
  settings = defaultEditorSettings,
  onUpload,
  placeholder,
  autoFocus = false,
  extraExtensions,
}: MarkdownEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const langRef = useRef<HTMLSelectElement>(null);
  const { resolved } = useTheme();

  const extensions = useMemo<Extension[]>(
    () => [
      // GFM base + nested code-block highlighting via lazily-loaded language data
      // (F121/F126). markdown() also installs the smart-list Enter/Backspace keymap (F125).
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      Prec.high(keymap.of(editorKeymap)),
      EditorView.theme({
        '&': { fontSize: `${settings.fontSize}px` },
        ...(settings.lineWidth > 0
          ? { '.cm-content': { maxWidth: `${settings.lineWidth}ch`, marginInline: 'auto' } }
          : {}),
      }),
      ...(settings.softWrap ? [EditorView.lineWrapping] : []),
      ...(onUpload ? [fileUploadExtension(onUpload)] : []),
      ...(extraExtensions ?? []),
    ],
    [settings, onUpload, extraExtensions],
  );

  const run = (command: StateCommand) => {
    const view = cmRef.current?.view;
    if (!view) return;
    command(view);
    view.focus();
  };

  const attachFiles = (files: FileList | null) => {
    const view = cmRef.current?.view;
    if (!view || !onUpload || !files || files.length === 0) return;
    void insertFiles(view, Array.from(files), view.state.selection.main.from, onUpload);
    view.focus();
  };

  return (
    <div className="md-editor">
      <div className="md-editor__toolbar" role="toolbar" aria-label="Formatting">
        {TOOLBAR.map(({ id, label, shortcut, icon: Icon, command }) => (
          <button
            key={id}
            type="button"
            className="md-editor__tool"
            title={`${label} (${shortcut})`}
            aria-label={label}
            onClick={() => run(command)}
          >
            <Icon size={16} />
          </button>
        ))}
        <span className="md-editor__sep" aria-hidden="true" />
        <select
          ref={langRef}
          className="md-editor__lang"
          aria-label="Code block language"
          defaultValue=""
        >
          {CODE_BLOCK_LANGUAGES.map((lang) => (
            <option key={lang || 'plain'} value={lang}>
              {lang || 'plain'}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="md-editor__tool"
          title="Insert code block (Mod-Alt-C)"
          aria-label="Code block"
          onClick={() => run(insertCodeBlock(langRef.current?.value ?? ''))}
        >
          <Code size={16} strokeWidth={2.5} />
        </button>
        {onUpload && (
          <>
            <button
              type="button"
              className="md-editor__tool"
              title="Attach image or file"
              aria-label="Attach file"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus size={16} />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              data-testid="md-editor-file-input"
              onChange={(e) => {
                attachFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>
      <CodeMirror
        ref={cmRef}
        value={value}
        onChange={onChange}
        // 'dark' brings the one-dark token palette; chrome colors are overridden
        // with Fables CSS tokens in editor.css so both themes match the app (F122).
        theme={resolved}
        extensions={extensions}
        indentWithTab={false}
        autoFocus={autoFocus}
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLineGutter: false }}
        {...(placeholder !== undefined ? { placeholder } : {})}
      />
    </div>
  );
}
