/**
 * Notes editor demo (Day 2): wires MarkdownEditor + SplitView + MarkdownPreview
 * on local state so the whole F121–F140 pipeline is visible in `pnpm dev`.
 * Server binding (note CRUD + attachments) comes from the server lane later.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Settings2 } from '@fables/ui';
import { MarkdownEditor } from '../editor/MarkdownEditor.js';
import {
  defaultEditorSettings,
  loadEditorSettings,
  saveEditorSettings,
  type EditorSettings,
} from '../editor/settings.js';
import {
  MarkdownPreview,
  defaultPreviewSettings,
  type PreviewSettings,
} from '../preview/MarkdownPreview.js';
import { SplitView } from '../preview/SplitView.js';
import { TableOfContents } from '../preview/TableOfContents.js';
import { toggleTaskAtLine } from '../preview/tasks.js';

const SAMPLE_NOTE = `# The Fox and the Compiler

A **fox** found a *compiler* humming in the woods.[^origin]

## The bargain

> "Compile my schemes," said the fox, "and I will share the spoils."

- [x] flatter the compiler
- [ ] steal the \`bytecode\`
- [ ] outrun the garbage collector

### The plan

1. Write the fable
2. Run the build
3. Ship before sunset

| Character | Role        |
| --------- | ----------- |
| Fox       | Trickster   |
| Compiler  | Straight man |

\`\`\`js
function moral(cunning, patience) {
  return cunning > patience ? 'caught' : 'fed';
}
\`\`\`

Math works too (enable it in settings): $e^{i\\pi} + 1 = 0$

[^origin]: As told in the Fables monorepo, Day 2.
`;

const PREVIEW_SETTINGS_KEY = 'fables.preview.settings';

function loadPreviewSettings(): PreviewSettings {
  try {
    const raw = localStorage.getItem(PREVIEW_SETTINGS_KEY);
    return raw
      ? { ...defaultPreviewSettings, ...(JSON.parse(raw) as Partial<PreviewSettings>) }
      : defaultPreviewSettings;
  } catch {
    return defaultPreviewSettings;
  }
}

/** Mock uploader: the attachments endpoint lands in the server lane (F127). */
async function mockUpload(file: File): Promise<{ url: string }> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { url: URL.createObjectURL(file) };
}

export function EditorDemo() {
  const [doc, setDoc] = useState(SAMPLE_NOTE);
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(loadEditorSettings);
  const [previewSettings, setPreviewSettings] = useState<PreviewSettings>(loadPreviewSettings);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => saveEditorSettings(editorSettings), [editorSettings]);
  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_SETTINGS_KEY, JSON.stringify(previewSettings));
    } catch {
      // non-fatal: settings just won't persist
    }
  }, [previewSettings]);

  const onToggleTask = useCallback((line: number) => {
    setDoc((current) => toggleTaskAtLine(current, line));
  }, []);

  return (
    <div className="ui-stack" style={{ height: 'calc(100dvh - 140px)' }}>
      <div className="ui-row" style={{ justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
          Local demo note — server binding lands later today.
        </span>
        <Button onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
          <Settings2 size={14} /> Settings
        </Button>
      </div>

      {showSettings && (
        <div className="ui-row" style={{ flexWrap: 'wrap', fontSize: 'var(--text-sm)' }}>
          <label className="ui-row" style={{ gap: 'var(--space-1)' }}>
            Font
            <select
              className="ui-select"
              style={{ width: 'auto' }}
              value={editorSettings.fontSize}
              onChange={(e) =>
                setEditorSettings((s) => ({ ...s, fontSize: Number(e.target.value) }))
              }
            >
              {[13, 14, 15, 16, 18].map((px) => (
                <option key={px} value={px}>
                  {px}px
                </option>
              ))}
            </select>
          </label>
          <label className="ui-row" style={{ gap: 'var(--space-1)' }}>
            Line width
            <select
              className="ui-select"
              style={{ width: 'auto' }}
              value={editorSettings.lineWidth}
              onChange={(e) =>
                setEditorSettings((s) => ({ ...s, lineWidth: Number(e.target.value) }))
              }
            >
              <option value={0}>Full</option>
              {[60, 72, 80, 100].map((ch) => (
                <option key={ch} value={ch}>
                  {ch}ch
                </option>
              ))}
            </select>
          </label>
          <label className="ui-row" style={{ gap: 'var(--space-1)' }}>
            <input
              type="checkbox"
              checked={editorSettings.softWrap}
              onChange={(e) => setEditorSettings((s) => ({ ...s, softWrap: e.target.checked }))}
            />
            Soft wrap
          </label>
          <label className="ui-row" style={{ gap: 'var(--space-1)' }}>
            <input
              type="checkbox"
              checked={previewSettings.math}
              onChange={(e) => setPreviewSettings((s) => ({ ...s, math: e.target.checked }))}
            />
            Math (KaTeX)
          </label>
          <label
            className="ui-row"
            style={{ gap: 'var(--space-1)' }}
            title="Deferred (F137): mermaid is not installed yet"
          >
            <input
              type="checkbox"
              checked={previewSettings.mermaid}
              onChange={(e) => setPreviewSettings((s) => ({ ...s, mermaid: e.target.checked }))}
            />
            Mermaid (stub)
          </label>
          <Button
            onClick={() => {
              setEditorSettings(defaultEditorSettings);
              setPreviewSettings(defaultPreviewSettings);
            }}
          >
            Reset
          </Button>
        </div>
      )}

      <SplitView
        editor={
          <MarkdownEditor
            value={doc}
            onChange={setDoc}
            settings={editorSettings}
            onUpload={mockUpload}
            placeholder="Tell a fable…"
          />
        }
        preview={
          <>
            <TableOfContents source={doc} />
            <MarkdownPreview source={doc} settings={previewSettings} onToggleTask={onToggleTask} />
          </>
        }
      />
    </div>
  );
}
