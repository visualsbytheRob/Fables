// @vitest-environment jsdom
/**
 * Editor integration tests (F390): the assembled forge() extension running in
 * a real EditorView under jsdom — highlighting, diagnostics overlay + gutter,
 * idle recompile, go-to-definition, folding, and format-on-save (F378).
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EditorState, EditorView, type Extension } from '@uiw/react-codemirror';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compile } from '@fables/forge-dsl';
import { installCodeMirrorDomStubs } from '../test-utils/cm-dom.js';
import { COMPILE_IDLE_MS, forgeCompileField } from './compileField.js';
import { goToDefinition } from './definition.js';
import { computeFoldRanges, foldedRanges, toggleFoldAtLine } from './folding.js';
import { applyFormat, forgeFormatOnSave } from './format.js';
import { forge } from './language.js';
import { extractOutline } from './outline.js';
import { OutlinePanel } from './OutlinePanel.js';
import { renameAt } from './rename.js';

installCodeMirrorDomStubs();

const CLEAN = `-> den

=== den ===
The fox curls up.
* Sleep. # soft
  A hush falls.
  -> morning
+ Wait.
  -> den

=== morning ===
Sunlight, {1 + 1} beams of it.
-> END
`;

const views: EditorView[] = [];

function makeView(doc: string, extra: Extension[] = []): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [forge(), ...extra] }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  cleanup();
  vi.useRealTimers();
});

describe('forge() editor extension (F381/F390)', () => {
  it('renders compiler-backed syntax highlighting into the DOM', () => {
    const view = makeView(CLEAN);
    expect(view.dom.querySelector('.tok-forge-heading')?.textContent).toContain('===');
    expect(view.dom.querySelector('.tok-forge-choice')).not.toBeNull();
    expect(view.dom.querySelector('.tok-forge-divert')).not.toBeNull();
    expect(view.dom.querySelector('.tok-forge-tag')).not.toBeNull();
    expect(view.dom.querySelector('.tok-forge-number')).not.toBeNull();
  });

  it('shows squiggles and gutter markers for compile errors', () => {
    const view = makeView('-> nowhere\n');
    const squiggle = view.dom.querySelector('.cm-forge-diagnostic-error');
    expect(squiggle).not.toBeNull();
    expect(squiggle?.getAttribute('title')).toContain('FORGE202');
    expect(view.dom.querySelector('.cm-forge-gutter-error')).not.toBeNull();
  });

  it('starts clean and recompiles on idle after edits', () => {
    vi.useFakeTimers();
    const view = makeView(CLEAN);
    expect(view.state.field(forgeCompileField).ok).toBe(true);
    expect(view.dom.querySelector('.cm-forge-diagnostic-error')).toBeNull();

    view.dispatch({
      changes: { from: 0, to: 0, insert: '-> lost_warren\n' },
    });
    // stale result until the idle debounce fires
    expect(view.state.field(forgeCompileField).ok).toBe(true);
    vi.advanceTimersByTime(COMPILE_IDLE_MS + 10);
    expect(view.state.field(forgeCompileField).ok).toBe(false);
    expect(view.dom.querySelector('.cm-forge-diagnostic-error')).not.toBeNull();
  });

  it('jumps to the definition of the divert under the cursor (F385)', () => {
    const view = makeView(CLEAN);
    const refPos = CLEAN.indexOf('-> morning') + 4;
    view.dispatch({ selection: { anchor: refPos } });
    expect(goToDefinition(view)).toBe(true);
    expect(view.state.selection.main.from).toBe(CLEAN.indexOf('morning ==='));
  });

  it('folds and unfolds a knot through the fold state (F389)', () => {
    const view = makeView(CLEAN);
    const ranges = computeFoldRanges(view.state.field(forgeCompileField).ast, CLEAN);
    const headerLine = CLEAN.indexOf('=== den ===');
    expect(toggleFoldAtLine(view, headerLine, ranges)).toBe(true);
    expect(foldedRanges(view.state)).toHaveLength(1);
    expect(view.dom.querySelector('.cm-forge-fold-placeholder')).not.toBeNull();
    expect(toggleFoldAtLine(view, headerLine, ranges)).toBe(true);
    expect(foldedRanges(view.state)).toHaveLength(0);
  });

  it('applies a rename through a view dispatch (F388)', () => {
    const view = makeView(CLEAN);
    const result = view.state.field(forgeCompileField);
    const outcome = renameAt(result, CLEAN, CLEAN.indexOf('den ==='), 'burrow');
    if (!outcome.ok) throw new Error(outcome.reason);
    view.dispatch({ changes: outcome.edits.map((e) => ({ ...e })) });
    expect(view.state.doc.toString()).toContain('=== burrow ===');
    expect(view.state.doc.toString()).not.toContain('-> den');
  });
});

describe('format-on-save wiring (F378)', () => {
  it('applyFormat rewrites the document to canonical form', () => {
    const view = makeView('===den===\nHi.\n->END\n');
    const { changed, formatted } = applyFormat(view);
    expect(changed).toBe(true);
    expect(formatted).toBe('=== den ===\nHi.\n-> END\n');
    expect(view.state.doc.toString()).toBe(formatted);
  });

  it('leaves broken sources untouched (the formatter refuses to guess)', () => {
    const broken = '=== \nHi.\n';
    const view = makeView(broken);
    expect(applyFormat(view).changed).toBe(false);
    expect(view.state.doc.toString()).toBe(broken);
  });

  it('Mod-S formats then hands the text to onSave', () => {
    const onSave = vi.fn();
    const view = makeView('===den===\nHi.\n->END\n', [forgeFormatOnSave({ onSave })]);
    fireEvent.keyDown(view.contentDOM, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith('=== den ===\nHi.\n-> END\n');
    expect(view.state.doc.toString()).toBe('=== den ===\nHi.\n-> END\n');
  });
});

describe('OutlinePanel (F387)', () => {
  it('renders the tree and navigates on click', () => {
    const outline = extractOutline(compile(CLEAN).ast);
    const onSelect = vi.fn();
    const { getByText } = render(
      <OutlinePanel
        outline={outline}
        activeOffset={CLEAN.indexOf('Sunlight')}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(getByText('den'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'knot', name: 'den', offset: CLEAN.indexOf('den ===') }),
    );
    // the knot containing the cursor is highlighted
    expect(getByText('morning').className).toContain('is-active');
  });

  it('shows an empty state without knots', () => {
    const { getByText } = render(<OutlinePanel outline={[]} onSelect={() => {}} />);
    expect(getByText('No knots yet.')).toBeDefined();
  });
});
