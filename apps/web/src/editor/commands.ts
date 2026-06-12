/**
 * Markdown editing commands (F123–F125): pure CodeMirror StateCommands so the
 * toolbar, the keymap and the tests all share one implementation.
 *
 * Note: `@codemirror/state`/`view` are consumed via the `@uiw/react-codemirror`
 * re-exports — they are not direct dependencies of this package (pnpm strict).
 */
import { EditorSelection } from '@uiw/react-codemirror';
import type { EditorState, KeyBinding, Line, StateCommand } from '@uiw/react-codemirror';

const BULLET_RE = /^(\s*)[-*+]\s+/;
const ORDERED_RE = /^(\s*)\d+[.)]\s+/;
const QUOTE_RE = /^\s*>\s?/;
const HEADING_RE = /^(#{1,6})\s+/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/;

/** Unique lines touched by the current selection, in document order. */
function selectedLines(state: EditorState): Line[] {
  const seen = new Set<number>();
  const lines: Line[] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) {
      if (!seen.has(n)) {
        seen.add(n);
        lines.push(state.doc.line(n));
      }
    }
  }
  return lines;
}

/** Toggle a symmetric inline marker (`**`, `*`, `` ` ``) around each selection range. */
function toggleInline(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const len = marker.length;
    const tr = state.changeByRange((range) => {
      let { from, to } = range;
      if (from === to) {
        const word = state.wordAt(from);
        if (word) ({ from, to } = word);
      }
      const before = state.sliceDoc(Math.max(0, from - len), from);
      const after = state.sliceDoc(to, Math.min(state.doc.length, to + len));
      const inner = state.sliceDoc(from, to);

      if (before === marker && after === marker) {
        // |**bold**| with markers just outside the range: unwrap.
        return {
          changes: [
            { from: from - len, to: from },
            { from: to, to: to + len },
          ],
          range: EditorSelection.range(from - len, to - len),
        };
      }
      if (inner.length >= 2 * len && inner.startsWith(marker) && inner.endsWith(marker)) {
        // Markers inside the selected text: unwrap.
        return {
          changes: [
            { from, to: from + len },
            { from: to - len, to },
          ],
          range: EditorSelection.range(from, to - 2 * len),
        };
      }
      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + len, to + len),
      };
    });
    dispatch(state.update(tr, { userEvent: 'input', scrollIntoView: true }));
    return true;
  };
}

export const toggleBold: StateCommand = toggleInline('**');
export const toggleItalic: StateCommand = toggleInline('*');
export const toggleInlineCode: StateCommand = toggleInline('`');

/** Cycle line heading level: none → # → ## → ### → none (F123). */
export const cycleHeading: StateCommand = ({ state, dispatch }) => {
  const changes = selectedLines(state).map((line) => {
    const match = HEADING_RE.exec(line.text);
    const level = match?.[1]?.length ?? 0;
    const next = level >= 3 ? 0 : level + 1;
    return {
      from: line.from,
      to: line.from + (match?.[0]?.length ?? 0),
      insert: next === 0 ? '' : `${'#'.repeat(next)} `,
    };
  });
  dispatch(state.update({ changes, userEvent: 'input', scrollIntoView: true }));
  return true;
};

/** Per-line prefix toggle shared by bullet/ordered list commands. */
function toggleList(ordered: boolean): StateCommand {
  return ({ state, dispatch }) => {
    const all = selectedLines(state);
    const lines = all.length > 1 ? all.filter((l) => l.text.trim() !== '') : all;
    if (lines.length === 0) return false;
    const ownRe = ordered ? ORDERED_RE : BULLET_RE;
    const otherRe = ordered ? BULLET_RE : ORDERED_RE;
    const allMarked = lines.every((l) => ownRe.test(l.text));

    const changes = lines.map((line, i) => {
      const own = ownRe.exec(line.text);
      if (allMarked && own) {
        // Remove the marker, keep indentation.
        const indent = own[1] ?? '';
        return { from: line.from, to: line.from + own[0].length, insert: indent };
      }
      const other = otherRe.exec(line.text);
      const markerEnd = own?.[0]?.length ?? other?.[0]?.length ?? 0;
      const indent = own?.[1] ?? other?.[1] ?? '';
      return {
        from: line.from,
        to: line.from + markerEnd,
        insert: `${indent}${ordered ? `${i + 1}. ` : '- '}`,
      };
    });
    dispatch(state.update({ changes, userEvent: 'input', scrollIntoView: true }));
    return true;
  };
}

export const toggleBulletList: StateCommand = toggleList(false);
export const toggleOrderedList: StateCommand = toggleList(true);

/** Toggle `> ` blockquote prefix on all selected lines (F123). */
export const toggleQuote: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state);
  const allQuoted = lines.every((l) => QUOTE_RE.test(l.text));
  const changes = lines.map((line) => {
    if (allQuoted) {
      const match = QUOTE_RE.exec(line.text);
      return { from: line.from, to: line.from + (match?.[0]?.length ?? 0), insert: '' };
    }
    return { from: line.from, insert: '> ' };
  });
  dispatch(state.update({ changes, userEvent: 'input', scrollIntoView: true }));
  return true;
};

/** Insert a fenced code block with an optional language tag (F126). */
export function insertCodeBlock(language = ''): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main;
    const startLine = state.doc.lineAt(range.from);
    const endLine = state.doc.lineAt(range.to);
    const lead = range.from === startLine.from ? '' : '\n';
    const trail = range.to === endLine.to ? '' : '\n';
    const open = `${lead}\`\`\`${language}\n`;
    const body = range.empty ? '' : state.sliceDoc(range.from, range.to);
    const insert = `${open}${body}\n\`\`\`${trail}`;
    const bodyFrom = range.from + open.length;
    dispatch(
      state.update({
        changes: { from: range.from, to: range.to, insert },
        selection: EditorSelection.range(bodyFrom, bodyFrom + body.length),
        userEvent: 'input',
        scrollIntoView: true,
      }),
    );
    return true;
  };
}

/** Wrap the selection as `[text](url)`, selecting the placeholder to overtype (F123). */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to);
    const text = selected || 'link text';
    const insert = `[${text}](url)`;
    const select = selected
      ? EditorSelection.range(range.from + text.length + 3, range.from + text.length + 6) // "url"
      : EditorSelection.range(range.from + 1, range.from + 1 + text.length); // placeholder text
    return { changes: { from: range.from, to: range.to, insert }, range: select };
  });
  dispatch(state.update(tr, { userEvent: 'input', scrollIntoView: true }));
  return true;
};

/** Tab on a list item: indent one level (two spaces) (F125). */
export const indentListItem: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state).filter((l) => LIST_ITEM_RE.test(l.text));
  if (lines.length === 0) return false;
  dispatch(
    state.update({
      changes: lines.map((l) => ({ from: l.from, insert: '  ' })),
      userEvent: 'input',
    }),
  );
  return true;
};

/** Shift-Tab on a list item: outdent one level (F125). */
export const outdentListItem: StateCommand = ({ state, dispatch }) => {
  const changes = selectedLines(state)
    .filter((l) => LIST_ITEM_RE.test(l.text))
    .map((l) => {
      const spaces = /^ {1,2}/.exec(l.text)?.[0]?.length ?? 0;
      return { from: l.from, to: l.from + spaces };
    })
    .filter((c) => c.to > c.from);
  if (changes.length === 0) return false;
  dispatch(state.update({ changes, userEvent: 'delete' }));
  return true;
};

/**
 * Enter on an empty list item or quote line exits the block (F125).
 * Fills a gap: lang-markdown's `insertNewlineContinueMarkup` would instead
 * start a non-tight list when the second item is blank.
 */
export const exitListOnEmptyItem: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.from);
  if (range.from !== line.to) return false;
  if (!/^\s*(?:[-*+]|\d+[.)]|>)\s*$/.test(line.text) || line.text.trim() === '') return false;
  dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert: '' },
      userEvent: 'delete',
      scrollIntoView: true,
    }),
  );
  return true;
};

/** Tab fallback outside lists: insert a two-space soft tab. */
export const insertSoftTab: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: '  ' },
    range: EditorSelection.cursor(range.from + 2),
  }));
  dispatch(state.update(tr, { userEvent: 'input' }));
  return true;
};

/** Keyboard shortcuts for every toolbar action (F124). Bound at high precedence. */
export const editorKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-e', run: toggleInlineCode },
  { key: 'Mod-k', run: insertLink },
  { key: 'Mod-Shift-h', run: cycleHeading },
  { key: 'Mod-Shift-8', run: toggleBulletList },
  { key: 'Mod-Shift-7', run: toggleOrderedList },
  { key: 'Mod-Shift-9', run: toggleQuote },
  { key: 'Mod-Alt-c', run: insertCodeBlock() },
  { key: 'Enter', run: exitListOnEmptyItem },
  { key: 'Tab', run: indentListItem },
  { key: 'Tab', run: insertSoftTab },
  { key: 'Shift-Tab', run: outdentListItem },
];
