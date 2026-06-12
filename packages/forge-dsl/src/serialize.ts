import type { AnyNode } from './ast.js';

/**
 * Stable AST JSON serialization (F337).
 *
 * Guarantees:
 *  - `parent` pointers are never serialized (they would cycle).
 *  - Object keys are emitted in sorted order, so output is byte-stable for a
 *    given tree regardless of construction order.
 *  - A `$schema` version is embedded so future format changes are detectable.
 */

export const AST_JSON_VERSION = 1;

const OMIT_KEYS = new Set(['parent']);

function toPlain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPlain);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (OMIT_KEYS.has(key)) continue;
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = toPlain(v);
    }
    return out;
  }
  return value;
}

/** Serialize an AST node to a stable, parent-free JSON string. */
export function serializeAst(node: AnyNode, options: { pretty?: boolean } = {}): string {
  const payload = { $schema: `forge-ast/v${AST_JSON_VERSION}`, root: toPlain(node) };
  return options.pretty === false ? JSON.stringify(payload) : JSON.stringify(payload, null, 2);
}

/** Plain-object form (parent-free, sorted keys) for snapshot tests. */
export function astToPlainObject(node: AnyNode): unknown {
  return toPlain(node);
}
