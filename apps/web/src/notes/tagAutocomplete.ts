/**
 * Tag autocomplete on `#` (F153). Registered as markdown language data so
 * the autocompletion already bundled in the editor's basic setup picks it
 * up — no extra CodeMirror packages needed.
 */
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Extension } from '@uiw/react-codemirror';

/** Structural subset of @codemirror/autocomplete's CompletionContext. */
export interface TagCompletionContext {
  explicit: boolean;
  matchBefore(expr: RegExp): { from: number; to: number; text: string } | null;
}

export interface TagCompletionResult {
  from: number;
  options: { label: string; type: string; apply: string }[];
  validFor: RegExp;
}

const TRIGGER_RE = /#[\w/-]*$/;

/** Pure completion source over a live tag-name getter, so tests need no editor. */
export function tagCompletionSource(getTagNames: () => string[]) {
  return (context: TagCompletionContext): TagCompletionResult | null => {
    const match = context.matchBefore(TRIGGER_RE);
    if (!match) return null;
    const query = match.text.slice(1).toLowerCase();
    const names = getTagNames();
    const options = names
      .filter((name) => name.startsWith(query) || name.includes(`/${query}`))
      .slice(0, 20)
      .map((name) => ({ label: `#${name}`, type: 'keyword', apply: `#${name}` }));
    if (options.length === 0) return null;
    return { from: match.from, options, validFor: /^#[\w/-]*$/ };
  };
}

/** Editor extension wiring the source into markdown's language data. */
export function tagAutocomplete(getTagNames: () => string[]): Extension {
  return markdownLanguage.data.of({ autocomplete: tagCompletionSource(getTagNames) });
}
