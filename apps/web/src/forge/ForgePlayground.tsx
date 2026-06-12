/**
 * Forge playground (F381–F390 demo): a dev route showing the .fable editor
 * stack on a sample story — live diagnostics, outline navigation, hover,
 * Cmd/Ctrl-click go-to-definition, F2 rename, fold gutter, Mod-S
 * format-on-save. The real story editing page lands on Day 6.
 */
import { useMemo, useRef, useState } from 'react';
import CodeMirror, { EditorSelection, EditorView } from '@uiw/react-codemirror';
import type { Extension, ViewUpdate } from '@uiw/react-codemirror';
import { useTheme, useToast } from '@fables/ui';
import type { CompileResult } from '@fables/forge-dsl';
import { forge } from './language.js';
import { forgeCompileField } from './compileField.js';
import { mapDiagnostics, type MappedDiagnostic } from './diagnostics.js';
import { outlineFromResult, type OutlineEntry } from './outline.js';
import { OutlinePanel } from './OutlinePanel.js';

const SAMPLE = `# title: The Fox and the Lantern
# author: you

VAR cunning = 3
VAR lantern_lit = false
VAR satchel = ["flint", "dry moss"]

-> forest_gate

=== forest_gate ===
The gate to the night-wood stands open. @fox(Reynard) sniffs the cold air.
The lantern is {lantern_lit: burning low|dark and cold}.
* {satchel has "flint"} Strike the flint.
  ~ lantern_lit = true
  A small flame catches. <> It steadies into gold.
  -> forest_gate
* (listen) Listen at the gate. # quiet
  The wood {&rustles|holds its breath|ticks like a clock}.
  -> forest_gate
+ Step through.
  -> mossy_hollow

=== mossy_hollow ===
Moss swallows every footfall. See [[The Night-Wood]] for the old map.
~ temp omen = RANDOM(1, 6) + cunning
{omen > 5: A white owl turns its head to follow you.|The dark keeps its own counsel.}
-> owl_question ->
You have visited the hollow {mossy_hollow} time{mossy_hollow == 1: |s}.
-> END

=== owl_question ===
"Who lit the lantern?" the owl asks.
= answer
* Tell the truth.
  ->->
+ Say nothing.
  ->->
`;

function DiagnosticList({
  diagnostics,
  onSelect,
}: {
  diagnostics: MappedDiagnostic[];
  onSelect: (d: MappedDiagnostic) => void;
}) {
  if (diagnostics.length === 0) {
    return <p className="forge-diagnostic-empty">No problems — the compiler is content.</p>;
  }
  return (
    <ul className="forge-diagnostic-list">
      {diagnostics.map((d, i) => (
        <li
          key={`${d.code}-${d.from}-${i}`}
          className={`severity-${d.severity}`}
          onClick={() => onSelect(d)}
        >
          L{d.line} {d.code} — {d.message}
        </li>
      ))}
    </ul>
  );
}

export function ForgePlaygroundPage() {
  const { resolved } = useTheme();
  const { toast } = useToast();
  const viewRef = useRef<EditorView | null>(null);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [cursor, setCursor] = useState(0);

  const extensions = useMemo<Extension[]>(
    () => [
      forge({ save: { onSave: () => toast('Formatted and saved (playground stub)') } }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.selectionSet || update.docChanged) {
          setCursor(update.state.selection.main.head);
        }
        const next = update.state.field(forgeCompileField, false) ?? null;
        setResult((prev) => (prev === next ? prev : next));
      }),
    ],
    [toast],
  );

  const outline = useMemo(() => (result !== null ? outlineFromResult(result) : []), [result]);
  const diagnostics = useMemo(
    () =>
      result !== null && viewRef.current !== null
        ? mapDiagnostics(result, viewRef.current.state.doc.length)
        : [],
    [result],
  );

  const jumpTo = (offset: number): void => {
    const view = viewRef.current;
    if (view === null) return;
    const pos = Math.min(offset, view.state.doc.length);
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    view.focus();
  };

  return (
    <div>
      <h1>Forge playground</h1>
      <p style={{ color: 'var(--text-dim)' }}>
        The .fable language tooling, compiler-backed: squiggles + gutter diagnostics, hover for
        types and knot summaries, Cmd/Ctrl-click or F12 for go-to-definition, F2 to rename, click
        the fold gutter on knot/choice lines, Mod-S to format &amp; save.
      </p>
      <div className="forge-playground">
        <div className="forge-playground-editor">
          <CodeMirror
            value={SAMPLE}
            theme={resolved}
            height="540px"
            extensions={extensions}
            indentWithTab={false}
            onCreateEditor={(view) => {
              viewRef.current = view;
              setResult(view.state.field(forgeCompileField, false) ?? null);
            }}
            basicSetup={{ lineNumbers: true, foldGutter: false }}
          />
        </div>
        <aside className="forge-playground-side">
          <OutlinePanel
            outline={outline}
            activeOffset={cursor}
            onSelect={(entry: OutlineEntry) => jumpTo(entry.offset)}
          />
          <div>
            <div className="forge-outline-title">Problems</div>
            <DiagnosticList diagnostics={diagnostics} onSelect={(d) => jumpTo(d.from)} />
          </div>
        </aside>
      </div>
    </div>
  );
}
