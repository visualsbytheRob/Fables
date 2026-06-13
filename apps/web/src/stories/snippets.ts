/**
 * Snippet palette entries (F517): canonical Forge fragments inserted at the
 * cursor. `caret` is the offset inside `body` where the cursor lands.
 */

export interface Snippet {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly body: string;
  readonly caret: number;
}

const make = (id: string, label: string, detail: string, body: string): Snippet => {
  const marker = body.indexOf('$0');
  return {
    id,
    label,
    detail,
    body: body.replace('$0', ''),
    caret: marker === -1 ? body.length : marker,
  };
};

export const SNIPPETS: readonly Snippet[] = [
  make(
    'choice-block',
    'Choice block',
    'Two choices and a gather',
    '* $0First option.\n  -> END\n+ Second option (sticky).\n  -> END\n- And the flow rejoins here.\n',
  ),
  make('knot', 'Knot', 'A new scene with an END divert', '\n=== $0scene ===\nWrite the scene.\n-> END\n'),
  make(
    'conditional',
    'Conditional text',
    '{condition: then | else}',
    '{$0condition: shown when true|shown when false}',
  ),
  make('cycle', 'Cycle alternative', '{&a|b|c} rotates each visit', '{&$0first|second|third}'),
  make('sequence', 'Sequence alternative', '{a|b|c} runs once each, then sticks', '{$0first|second|third}'),
  make('var', 'Variable declaration', 'VAR name = value', 'VAR $0name = 0\n'),
  make('tunnel', 'Tunnel call', '-> target -> returns here', '-> $0target ->'),
];

/** Insert a snippet into source at `at`; returns the new text and caret. */
export function insertSnippet(
  source: string,
  at: number,
  snippet: Snippet,
): { text: string; caret: number } {
  const clamped = Math.max(0, Math.min(at, source.length));
  return {
    text: source.slice(0, clamped) + snippet.body + source.slice(clamped),
    caret: clamped + snippet.caret,
  };
}
