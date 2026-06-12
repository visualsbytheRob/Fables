/**
 * Folding (F389): knots, stitches, and choice bodies fold. Ranges come from
 * the AST (pure, tested); the extension is a small self-contained fold
 * implementation — replace decorations + a fold gutter — so it needs only
 * @codemirror/state and @codemirror/view primitives.
 */
import {
  Decoration,
  EditorView,
  GutterMarker,
  StateEffect,
  StateField,
  WidgetType,
  gutter,
} from '@uiw/react-codemirror';
import type { DecorationSet, EditorState, Extension } from '@uiw/react-codemirror';
import { computeLineStarts, parse, type BlockItem, type StoryNode } from '@fables/forge-dsl';

export interface FoldRange {
  /** Fold starts at the end of the header line… */
  readonly from: number;
  /** …and covers up to the end of the construct. */
  readonly to: number;
  readonly kind: 'knot' | 'stitch' | 'choice';
}

/** End offset of the line containing `offset` (excludes the newline). */
function lineEnd(source: string, lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  const nextStart = lineStarts[lo + 1];
  return nextStart === undefined ? source.length : nextStart - 1;
}

function trimEndOffset(source: string, to: number, floor: number): number {
  let end = to;
  while (end > floor && /\s/.test(source[end - 1] ?? '')) end--;
  return end;
}

/** Foldable ranges for knots, stitches, and choices with nested bodies. */
export function computeFoldRanges(story: StoryNode, source: string): FoldRange[] {
  const lineStarts = computeLineStarts(source);
  const out: FoldRange[] = [];
  const add = (headerOffset: number, endOffset: number, kind: FoldRange['kind']): void => {
    const from = lineEnd(source, lineStarts, headerOffset);
    const to = trimEndOffset(source, Math.min(endOffset, source.length), from);
    if (to > from) out.push({ from, to, kind });
  };

  const visitChoices = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      if (item.kind !== 'Choice') continue;
      if (item.body.items.length > 0) {
        add(item.span.start.offset, item.span.end.offset, 'choice');
        visitChoices(item.body.items);
      }
    }
  };

  for (const knot of story.knots) {
    add(knot.name.span.start.offset, knot.span.end.offset, 'knot');
    visitChoices(knot.body.items);
    for (const stitch of knot.stitches) {
      add(stitch.name.span.start.offset, stitch.span.end.offset, 'stitch');
      visitChoices(stitch.body.items);
    }
  }
  visitChoices(story.preamble.items);
  return out.sort((a, b) => a.from - b.from || b.to - a.to);
}

// ── fold state ───────────────────────────────────────────────────────────────

export const foldRange = StateEffect.define<{ from: number; to: number }>();
export const unfoldRange = StateEffect.define<{ from: number }>();

class FoldPlaceholder extends WidgetType {
  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-forge-fold-placeholder';
    el.textContent = '…';
    el.title = 'Click to unfold';
    el.onclick = (event) => {
      const pos = view.posAtDOM(el);
      view.dispatch({ effects: unfoldRange.of({ from: pos }) });
      event.preventDefault();
    };
    return el;
  }

  override eq(): boolean {
    return true;
  }
}

export const foldedField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(folded, tr) {
    let next = folded.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(foldRange)) {
        next = next.update({
          add: [
            Decoration.replace({ widget: new FoldPlaceholder(), block: false }).range(
              effect.value.from,
              effect.value.to,
            ),
          ],
        });
      } else if (effect.is(unfoldRange)) {
        next = next.update({
          filter: (from, to) => effect.value.from < from || effect.value.from > to,
        });
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function foldedRanges(state: EditorState): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  state.field(foldedField, false)?.between(0, state.doc.length, (from, to) => {
    out.push({ from, to });
  });
  return out;
}

/** Toggle the innermost foldable range whose header is on the given line. */
export function toggleFoldAtLine(view: EditorView, lineFrom: number, ranges: FoldRange[]): boolean {
  const line = view.state.doc.lineAt(lineFrom);
  const folded = foldedRanges(view.state).find((r) => r.from >= line.from && r.from <= line.to);
  if (folded !== undefined) {
    view.dispatch({ effects: unfoldRange.of({ from: folded.from }) });
    return true;
  }
  const candidate = ranges.find((r) => r.from >= line.from && r.from <= line.to);
  if (candidate === undefined) return false;
  view.dispatch({ effects: foldRange.of({ from: candidate.from, to: candidate.to }) });
  return true;
}

// ── gutter ───────────────────────────────────────────────────────────────────

class FoldGutterMarker extends GutterMarker {
  constructor(private readonly open: boolean) {
    super();
  }

  override toDOM(): Node {
    const el = document.createElement('span');
    el.className = 'cm-forge-fold-marker';
    el.textContent = this.open ? '▾' : '▸';
    return el;
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof FoldGutterMarker && other.open === this.open;
  }
}

let rangeCache: { source: string; ranges: FoldRange[] } | null = null;

function rangesFor(state: EditorState): FoldRange[] {
  const source = state.doc.toString();
  if (rangeCache === null || rangeCache.source !== source) {
    rangeCache = { source, ranges: computeFoldRanges(parse(source).story, source) };
  }
  return rangeCache.ranges;
}

export function forgeFolding(): Extension {
  return [
    foldedField,
    gutter({
      class: 'cm-forge-fold-gutter',
      lineMarker(view, line) {
        const lineNo = view.state.doc.lineAt(line.from);
        const folded = foldedRanges(view.state).some(
          (r) => r.from >= lineNo.from && r.from <= lineNo.to,
        );
        if (folded) return new FoldGutterMarker(false);
        const foldable = rangesFor(view.state).some(
          (r) => r.from >= lineNo.from && r.from <= lineNo.to,
        );
        return foldable ? new FoldGutterMarker(true) : null;
      },
      lineMarkerChange: (update) => update.docChanged,
      domEventHandlers: {
        click(view, line) {
          return toggleFoldAtLine(view, line.from, rangesFor(view.state));
        },
      },
    }),
  ];
}
