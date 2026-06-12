/**
 * Autocomplete (F384): a pure completion source over the shared compile
 * result. Registered through the EditorState.languageData facet so the
 * bundled autocompletion from basic-setup picks it up — no direct
 * @codemirror/autocomplete dependency, mirroring wikilinkAutocomplete.
 *
 * Completes:
 *   `-> …`   divert targets (knots, dotted stitches/labels, END/DONE)
 *   `@…`     entity binding stubs (names already bound in the document)
 *   `[[…`    note reference stubs (titles already referenced)
 *   logic    variables, temps in scope, builtin functions, true/false
 */
import { EditorState } from '@uiw/react-codemirror';
import type { Extension } from '@uiw/react-codemirror';
import {
  BUILTIN_FUNCTIONS,
  findAll,
  type CompileResult,
  type KnotNode,
  type StoryNode,
} from '@fables/forge-dsl';
import { forgeCompileField } from './compileField.js';

/** Structural subset of @codemirror/autocomplete's CompletionContext. */
export interface ForgeCompletionContext {
  readonly state: EditorState;
  readonly pos: number;
  readonly explicit: boolean;
  matchBefore(expr: RegExp): { from: number; to: number; text: string } | null;
}

export interface ForgeCompletionOption {
  readonly label: string;
  readonly type: string;
  readonly detail?: string;
  readonly apply?: string;
}

export interface ForgeCompletionResult {
  readonly from: number;
  readonly options: ForgeCompletionOption[];
  readonly validFor: RegExp;
}

const DIVERT_RE = /->\s*([A-Za-z_][\w.]*|\.)?$/;
const BINDING_RE = /@([A-Za-z_]\w*)?$/;
const NOTE_RE = /\[\[([^\]\n]*)?$/;
const IDENT_RE = /[A-Za-z_]\w*$/;
const VALID_IDENT = /^[\w.]*$/;

/** The knot whose span contains `offset`, if any. */
export function knotAt(story: StoryNode, offset: number): KnotNode | undefined {
  return story.knots.find((k) => offset >= k.span.start.offset && offset <= k.span.end.offset);
}

function isLogicContext(lineText: string, col: number): boolean {
  const before = lineText.slice(0, col);
  const trimmed = before.trimStart();
  if (/^(~|VAR\b|CONST\b)/.test(trimmed)) return true;
  // Inside an unclosed `{ … }` inline block on this line.
  let depth = 0;
  for (const ch of before) {
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

function divertTargetOptions(result: CompileResult, offset: number): ForgeCompletionOption[] {
  const here = knotAt(result.ast, offset);
  const options: ForgeCompletionOption[] = [
    { label: 'END', type: 'keyword', detail: 'finish the story' },
    { label: 'DONE', type: 'keyword', detail: 'finish this flow' },
  ];
  for (const target of result.symbols.targets.values()) {
    options.push({ label: target.fullPath, type: target.kind, detail: target.kind });
    if (here !== undefined && target.knot === here.name.name && target.kind !== 'knot') {
      // Inside its own knot a stitch/label is addressable by short name.
      options.push({ label: target.name, type: target.kind, detail: `${target.kind} (local)` });
    }
  }
  return dedupe(options);
}

function variableOptions(result: CompileResult, offset: number): ForgeCompletionOption[] {
  const options: ForgeCompletionOption[] = [];
  for (const g of result.symbols.globals.values()) {
    options.push({ label: g.name, type: 'variable', detail: g.declKind });
  }
  const here = knotAt(result.ast, offset);
  const tempKey = `::${here?.name.name ?? ''}`;
  for (const t of result.symbols.temps.get(tempKey)?.values() ?? []) {
    options.push({ label: t.name, type: 'variable', detail: 'temp' });
  }
  for (const knot of result.symbols.knots.values()) {
    options.push({ label: knot.name, type: 'constant', detail: 'read count' });
  }
  for (const [name, sig] of Object.entries(BUILTIN_FUNCTIONS)) {
    options.push({
      label: name,
      type: 'function',
      detail: `(${sig.params.join(', ')}) → ${sig.result}`,
      apply: `${name}(${sig.params.length === 0 ? ')' : ''}`,
    });
  }
  options.push({ label: 'true', type: 'keyword' }, { label: 'false', type: 'keyword' });
  return dedupe(options);
}

function bindingOptions(result: CompileResult): ForgeCompletionOption[] {
  const seen = new Set<string>();
  const options: ForgeCompletionOption[] = [];
  for (const ref of findAll(result.ast, 'EntityRef')) {
    const name = ref.displayName !== undefined ? `${ref.name}(${ref.displayName})` : ref.name;
    if (seen.has(name)) continue;
    seen.add(name);
    options.push({ label: `@${name}`, type: 'class', detail: 'entity binding' });
  }
  if (options.length === 0) {
    options.push({
      label: '@entity(Name)',
      type: 'class',
      detail: 'entity binding stub',
      apply: '@entity(Name)',
    });
  }
  return options;
}

function noteOptions(result: CompileResult): ForgeCompletionOption[] {
  const seen = new Set<string>();
  const options: ForgeCompletionOption[] = [];
  for (const ref of findAll(result.ast, 'NoteRef')) {
    if (ref.title === '' || seen.has(ref.title)) continue;
    seen.add(ref.title);
    options.push({ label: ref.title, type: 'text', detail: 'note', apply: `${ref.title}]]` });
  }
  if (options.length === 0) {
    options.push({ label: 'Note Title', type: 'text', detail: 'note stub', apply: 'Note Title]]' });
  }
  return options;
}

function dedupe(options: ForgeCompletionOption[]): ForgeCompletionOption[] {
  const seen = new Set<string>();
  return options.filter((o) => {
    if (seen.has(o.label)) return false;
    seen.add(o.label);
    return true;
  });
}

/** The completion source. Pure over (state, pos); tested without a view. */
export function forgeCompletionSource(
  context: ForgeCompletionContext,
): ForgeCompletionResult | null {
  const result = context.state.field(forgeCompileField, false);
  if (result === undefined) return null;

  const divert = context.matchBefore(DIVERT_RE);
  if (divert !== null) {
    const arrow = /->\s*/.exec(divert.text);
    const from = divert.from + (arrow?.[0].length ?? divert.text.length);
    return { from, options: divertTargetOptions(result, context.pos), validFor: VALID_IDENT };
  }

  const note = context.matchBefore(NOTE_RE);
  if (note !== null) {
    return { from: note.from + 2, options: noteOptions(result), validFor: /^[^\]\n]*$/ };
  }

  const binding = context.matchBefore(BINDING_RE);
  if (binding !== null) {
    return { from: binding.from, options: bindingOptions(result), validFor: /^@?[\w.()]*$/ };
  }

  const line = context.state.doc.lineAt(context.pos);
  if (!isLogicContext(line.text, context.pos - line.from)) return null;
  const word = context.matchBefore(IDENT_RE);
  if (word === null && !context.explicit) return null;
  return {
    from: word?.from ?? context.pos,
    options: variableOptions(result, context.pos),
    validFor: /^\w*$/,
  };
}

/**
 * Registration via the languageData facet — the autocompletion extension that
 * basic-setup installs collects sources from `languageDataAt('autocomplete')`.
 */
export function forgeCompletion(): Extension {
  return EditorState.languageData.of(() => [{ autocomplete: forgeCompletionSource }]);
}
