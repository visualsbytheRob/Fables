// @vitest-environment jsdom
import { EditorState } from '@uiw/react-codemirror';
import type { StateCommand } from '@uiw/react-codemirror';
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
  markdown,
  markdownLanguage,
} from '@codemirror/lang-markdown';
import { describe, expect, it } from 'vitest';
import {
  cycleHeading,
  exitListOnEmptyItem,
  indentListItem,
  insertCodeBlock,
  insertLink,
  insertSoftTab,
  outdentListItem,
  toggleBold,
  toggleBulletList,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleQuote,
} from './commands.js';

function mkState(doc: string, anchor = 0, head = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage })],
  });
}

/** Run a StateCommand against bare state (no view), returning the next state. */
function apply(state: EditorState, command: StateCommand): EditorState {
  let next = state;
  const handled = command({
    state,
    dispatch: (tr) => {
      next = tr.state;
    },
  });
  expect(handled).toBe(true);
  return next;
}

describe('inline toggles (F123/F124)', () => {
  it('wraps and unwraps a selection in bold markers', () => {
    const bolded = apply(mkState('hello world', 0, 5), toggleBold);
    expect(bolded.doc.toString()).toBe('**hello** world');
    const unbolded = apply(bolded, toggleBold);
    expect(unbolded.doc.toString()).toBe('hello world');
  });

  it('expands an empty selection to the word under the cursor', () => {
    const next = apply(mkState('hello world', 8), toggleItalic);
    expect(next.doc.toString()).toBe('hello *world*');
  });

  it('toggles inline code', () => {
    const next = apply(mkState('run pnpm test now', 4, 13), toggleInlineCode);
    expect(next.doc.toString()).toBe('run `pnpm test` now');
    expect(apply(next, toggleInlineCode).doc.toString()).toBe('run pnpm test now');
  });
});

describe('heading cycle (F123)', () => {
  it('cycles none → h1 → h2 → h3 → none', () => {
    let state = mkState('A title');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      state = apply(state, cycleHeading);
      seen.push(state.doc.toString());
    }
    expect(seen).toEqual(['# A title', '## A title', '### A title', 'A title']);
  });
});

describe('list toggles (F123)', () => {
  it('adds and removes bullet markers across selected lines', () => {
    const doc = 'alpha\nbeta';
    const listed = apply(mkState(doc, 0, doc.length), toggleBulletList);
    expect(listed.doc.toString()).toBe('- alpha\n- beta');
    const unlisted = apply(listed, toggleBulletList);
    expect(unlisted.doc.toString()).toBe('alpha\nbeta');
  });

  it('numbers ordered lists sequentially and converts from bullets', () => {
    const doc = '- a\n- b\n- c';
    const ordered = apply(mkState(doc, 0, doc.length), toggleOrderedList);
    expect(ordered.doc.toString()).toBe('1. a\n2. b\n3. c');
  });

  it('skips blank lines in multi-line selections', () => {
    const doc = 'a\n\nb';
    const listed = apply(mkState(doc, 0, doc.length), toggleBulletList);
    expect(listed.doc.toString()).toBe('- a\n\n- b');
  });
});

describe('quote toggle (F123)', () => {
  it('prefixes and unprefixes "> "', () => {
    const doc = 'wise\nwords';
    const quoted = apply(mkState(doc, 0, doc.length), toggleQuote);
    expect(quoted.doc.toString()).toBe('> wise\n> words');
    expect(apply(quoted, toggleQuote).doc.toString()).toBe('wise\nwords');
  });
});

describe('code blocks (F126)', () => {
  it('wraps the selection in a fence with a language tag', () => {
    const doc = 'const x = 1;';
    const next = apply(mkState(doc, 0, doc.length), insertCodeBlock('ts'));
    expect(next.doc.toString()).toBe('```ts\nconst x = 1;\n```');
    // body stays selected for further editing
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe('const x = 1;');
  });

  it('inserts an empty fence with the cursor inside', () => {
    const next = apply(mkState(''), insertCodeBlock('python'));
    expect(next.doc.toString()).toBe('```python\n\n```');
    expect(next.selection.main.from).toBe('```python\n'.length);
  });
});

describe('links (F123)', () => {
  it('wraps the selection and selects the url placeholder', () => {
    const next = apply(mkState('Fables', 0, 6), insertLink);
    expect(next.doc.toString()).toBe('[Fables](url)');
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe('url');
  });

  it('inserts a placeholder when nothing is selected', () => {
    const next = apply(mkState(''), insertLink);
    expect(next.doc.toString()).toBe('[link text](url)');
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe('link text');
  });
});

describe('smart lists (F125)', () => {
  it('Enter continues a bullet list', () => {
    const doc = '- alpha';
    const next = apply(mkState(doc, doc.length), insertNewlineContinueMarkup);
    expect(next.doc.toString()).toBe('- alpha\n- ');
  });

  it('Enter continues an ordered list with the next number', () => {
    const doc = '1. alpha';
    const next = apply(mkState(doc, doc.length), insertNewlineContinueMarkup);
    expect(next.doc.toString()).toBe('1. alpha\n2. ');
  });

  it('Enter on an empty item exits the list', () => {
    const doc = '- alpha\n- ';
    const next = apply(mkState(doc, doc.length), exitListOnEmptyItem);
    expect(next.doc.toString()).toBe('- alpha\n');
  });

  it('Enter exit command defers to markup continuation on non-empty items', () => {
    const doc = '- alpha';
    const state = mkState(doc, doc.length);
    expect(exitListOnEmptyItem({ state, dispatch: () => {} })).toBe(false);
  });

  it('Backspace right after a marker deletes one level of markup', () => {
    const doc = '- alpha\n- ';
    const next = apply(mkState(doc, doc.length), deleteMarkupBackward);
    expect(next.doc.toString().endsWith('- ')).toBe(false);
  });

  it('Tab indents and Shift-Tab outdents list items', () => {
    const indented = apply(mkState('- alpha', 3), indentListItem);
    expect(indented.doc.toString()).toBe('  - alpha');
    const outdented = apply(indented, outdentListItem);
    expect(outdented.doc.toString()).toBe('- alpha');
  });

  it('Tab outside a list falls through to a soft tab', () => {
    const state = mkState('plain text', 0);
    expect(indentListItem({ state, dispatch: () => {} })).toBe(false);
    const next = apply(state, insertSoftTab);
    expect(next.doc.toString()).toBe('  plain text');
  });
});
