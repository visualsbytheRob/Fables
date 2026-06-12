/**
 * Live compiler state (F381/F383): the document is compiled with the real
 * @fables/forge-dsl front-end. The result lives in a StateField; a view
 * plugin recompiles on idle (debounced) after document changes so squiggles,
 * completions, hover and the outline all read one shared, current result.
 */
import { Facet, StateEffect, StateField, ViewPlugin } from '@uiw/react-codemirror';
import type { EditorState, EditorView, Extension, ViewUpdate } from '@uiw/react-codemirror';
import { compile, type CompileOptions, type CompileResult } from '@fables/forge-dsl';

/** Injectable compiler options (knowledge resolver, file provider, severities). */
export const forgeCompileConfig = Facet.define<CompileOptions, CompileOptions>({
  combine: (values) => values[0] ?? {},
});

export const setCompileResult = StateEffect.define<CompileResult>();

export const forgeCompileField = StateField.define<CompileResult>({
  create(state: EditorState) {
    return compile(state.doc.toString(), state.facet(forgeCompileConfig));
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCompileResult)) return effect.value;
    }
    return value;
  },
});

export function getCompileResult(state: EditorState): CompileResult {
  return state.field(forgeCompileField);
}

export const COMPILE_IDLE_MS = 250;

/** Debounced recompile-on-idle plugin. */
const recompileOnIdle = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate): void {
      if (!update.docChanged) return;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        const state = this.view.state;
        const result = compile(state.doc.toString(), state.facet(forgeCompileConfig));
        this.view.dispatch({ effects: setCompileResult.of(result) });
      }, COMPILE_IDLE_MS);
    }

    destroy(): void {
      if (this.timer !== null) clearTimeout(this.timer);
    }
  },
);

export function forgeCompileExtension(options?: CompileOptions): Extension {
  return [
    ...(options !== undefined ? [forgeCompileConfig.of(options)] : []),
    forgeCompileField,
    recompileOnIdle,
  ];
}
