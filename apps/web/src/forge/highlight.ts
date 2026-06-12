/**
 * Syntax highlighting (F382): decorations computed by the tokenizer adapter.
 * Recomputed on document changes only — token spans are positions into the
 * current document, so unchanged docs reuse the previous decoration set.
 */
import { Decoration, ViewPlugin } from '@uiw/react-codemirror';
import type { DecorationSet, EditorView, Extension, ViewUpdate } from '@uiw/react-codemirror';
import { RangeSetBuilder } from '@uiw/react-codemirror';
import { forgeHighlightSpans, tokenClassName } from './tokens.js';

export function buildHighlightDecorations(source: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const span of forgeHighlightSpans(source)) {
    builder.add(span.from, span.to, Decoration.mark({ class: tokenClassName(span.cls) }));
  }
  return builder.finish();
}

const highlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildHighlightDecorations(view.state.doc.toString());
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.decorations = buildHighlightDecorations(update.state.doc.toString());
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function forgeHighlight(): Extension {
  return highlightPlugin;
}
