/**
 * FQL query variables (Epic 20, F1964).
 *
 * Parameterized saved queries: a query may reference `$name` placeholders that
 * are filled in at run time from a variable map. Substitution is purely textual
 * and happens *before* parsing — the parser/compiler then treat the result like
 * any other query, so values still flow through the parameterized SQL layer and
 * never reach the SQL text directly.
 */

const VAR_RE = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

/** The distinct variable names referenced by a query, in first-seen order. */
export function extractVariables(source: string): string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(VAR_RE)) {
    const name = match[1];
    if (name !== undefined) seen.add(name);
  }
  return [...seen];
}

export interface SubstituteResult {
  /** The query with every supplied variable expanded. */
  query: string;
  /** Variables referenced but not supplied (left untouched). */
  missing: string[];
}

/**
 * Expand `$name` placeholders from `vars`. A value containing whitespace and not
 * already quoted is wrapped in double quotes so it stays a single FQL term.
 * Unknown variables are left verbatim and reported in `missing`.
 */
export function substituteVariables(
  source: string,
  vars: Record<string, string>,
): SubstituteResult {
  const missing = new Set<string>();
  const query = source.replace(VAR_RE, (whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      missing.add(name);
      return whole;
    }
    const value = vars[name] ?? '';
    return needsQuoting(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  });
  return { query, missing: [...missing] };
}

function needsQuoting(value: string): boolean {
  if (value === '') return true;
  if (/\s/.test(value) && !(value.startsWith('"') && value.endsWith('"'))) return true;
  return false;
}
