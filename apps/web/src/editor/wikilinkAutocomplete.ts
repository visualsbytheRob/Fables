/**
 * Wikilink autocomplete on `[[` (F203). Same shape as tagAutocomplete: a pure
 * completion source registered as markdown language data, so the editor's
 * bundled autocompletion picks it up and tests need no editor instance.
 */
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Extension } from '@uiw/react-codemirror';

/** Structural subset of @codemirror/autocomplete's CompletionContext. */
export interface WikilinkCompletionContext {
  explicit: boolean;
  matchBefore(expr: RegExp): { from: number; to: number; text: string } | null;
}

export interface WikilinkCompletionResult {
  from: number;
  options: { label: string; type: string; apply: string }[];
  validFor: RegExp;
}

const TRIGGER_RE = /\[\[([^[\]\n]*)$/;
const MAX_OPTIONS = 20;

/** Pure completion source over a live note-title getter. */
export function wikilinkCompletionSource(getTitles: () => string[]) {
  return (context: WikilinkCompletionContext): WikilinkCompletionResult | null => {
    const match = context.matchBefore(TRIGGER_RE);
    if (!match) return null;
    const query = match.text.slice(2).toLowerCase();
    const titles = [
      ...new Set(
        getTitles()
          .map((t) => t.trim())
          .filter((t) => t !== ''),
      ),
    ];
    const ranked = [
      ...titles.filter((t) => t.toLowerCase().startsWith(query)),
      ...titles.filter(
        (t) => !t.toLowerCase().startsWith(query) && t.toLowerCase().includes(query),
      ),
    ];
    const options = ranked.slice(0, MAX_OPTIONS).map((title) => ({
      label: title,
      type: 'text',
      apply: `[[${title}]]`,
    }));
    if (options.length === 0) return null;
    return { from: match.from, options, validFor: /^\[\[[^[\]\n]*$/ };
  };
}

/** Editor extension wiring the source into markdown's language data. */
export function wikilinkAutocomplete(getTitles: () => string[]): Extension {
  return markdownLanguage.data.of({ autocomplete: wikilinkCompletionSource(getTitles) });
}
