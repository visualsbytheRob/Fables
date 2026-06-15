/**
 * Script static analysis + permission scoping (Epic 20, F1946–F1947).
 *
 * Scripts run against the same capability surface as plugins, so they declare
 * the same permission scopes. This pure module reads a script's source, finds
 * the `fables.<area>.<method>(...)` capability calls it makes, maps them to the
 * required scopes, and reports any a script uses but hasn't declared — a static
 * dry-run that catches an over-reaching script before it ever executes.
 */

/** The capability → required-scope map, mirroring the plugin sandbox rules. */
export const CAPABILITY_SCOPES: Record<string, string> = {
  'notes.query': 'notes:read',
  'notes.get': 'notes:read',
  'notes.tags': 'notes:read',
  'tags.list': 'notes:read',
  'notes.create': 'notes:write',
  'notes.update': 'notes:write',
  'notes.delete': 'notes:write',
  'search.extend': 'search:extend',
  'storage.get': 'storage',
  'storage.set': 'storage',
  'storage.delete': 'storage',
  'http.fetch': 'network',
};

/** Every scope a script may declare. */
export const KNOWN_SCOPES: string[] = [...new Set(Object.values(CAPABILITY_SCOPES))];

export function isKnownScope(scope: string): boolean {
  return KNOWN_SCOPES.includes(scope);
}

// Matches `fables.notes.create(` / `fables . notes . query (` etc.
const CALL_RE = /\bfables\s*\.\s*([a-zA-Z]+)\s*\.\s*([a-zA-Z]+)\s*\(/g;

/** The distinct capabilities (`area.method`) a script source invokes. */
export function extractCapabilities(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(CALL_RE)) {
    found.add(`${m[1]}.${m[2]}`);
  }
  return [...found].sort();
}

export interface ScopeCheck {
  /** Capabilities the script calls. */
  used: string[];
  /** Scopes those capabilities require. */
  requiredScopes: string[];
  /** Required scopes the script did not declare. */
  missingScopes: string[];
  /** Capabilities that aren't part of the known surface. */
  unknownCapabilities: string[];
  /** Declared scopes that nothing in the script actually uses. */
  unusedScopes: string[];
  ok: boolean;
}

/** Check a script's source against its declared scopes (F1947). */
export function checkScopes(source: string, declaredScopes: string[]): ScopeCheck {
  const declared = new Set(declaredScopes);
  const used = extractCapabilities(source);
  const requiredScopes = new Set<string>();
  const unknownCapabilities: string[] = [];

  for (const cap of used) {
    const scope = CAPABILITY_SCOPES[cap];
    if (scope === undefined) unknownCapabilities.push(cap);
    else requiredScopes.add(scope);
  }

  const missingScopes = [...requiredScopes].filter((s) => !declared.has(s)).sort();
  const unusedScopes = [...declared].filter((s) => !requiredScopes.has(s)).sort();

  return {
    used,
    requiredScopes: [...requiredScopes].sort(),
    missingScopes,
    unknownCapabilities,
    unusedScopes,
    ok: missingScopes.length === 0 && unknownCapabilities.length === 0,
  };
}
