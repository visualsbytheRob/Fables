/**
 * Runtime values (F441/F445): numbers, strings, booleans, lists (ordered sets
 * with origin tracking), divert targets, and story-visible error values
 * (F488). Plain JS primitives are used where possible; compound values are
 * tagged objects.
 */

export interface ListValue {
  readonly kind: 'list';
  /** Insertion-ordered unique elements. */
  readonly items: readonly Value[];
  /** Name of the variable the list literal originally initialized, if any. */
  readonly origin?: string;
}

export interface DivertValue {
  readonly kind: 'divert';
  readonly container: number;
  /** Container name — survives serialization across recompiles. */
  readonly name: string;
}

/** A story-visible error (effect/host failure, bad operation). Never throws. */
export interface ErrorValue {
  readonly kind: 'error';
  readonly message: string;
}

export type Value = number | string | boolean | ListValue | DivertValue | ErrorValue;

export function isList(v: Value): v is ListValue {
  return typeof v === 'object' && v.kind === 'list';
}
export function isDivert(v: Value): v is DivertValue {
  return typeof v === 'object' && v.kind === 'divert';
}
export function isErrorValue(v: Value): v is ErrorValue {
  return typeof v === 'object' && v.kind === 'error';
}

export function makeList(items: readonly Value[], origin?: string): ListValue {
  const seen: Value[] = [];
  for (const it of items) {
    if (!seen.some((s) => valueEquals(s, it))) seen.push(it);
  }
  return { kind: 'list', items: seen, ...(origin !== undefined ? { origin } : {}) };
}

export function errorValue(message: string): ErrorValue {
  return { kind: 'error', message };
}

export function valueEquals(a: Value, b: Value): boolean {
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  const bo = b as Exclude<Value, number | string | boolean>;
  if (a.kind !== bo.kind) return false;
  if (a.kind === 'list' && bo.kind === 'list') {
    return a.items.length === bo.items.length && a.items.every((v, i) => valueEquals(v, bo.items[i] as Value));
  }
  if (a.kind === 'divert' && bo.kind === 'divert') return a.name === bo.name;
  if (a.kind === 'error' && bo.kind === 'error') return a.message === bo.message;
  return false;
}

/** Truthiness: numbers ≠ 0, non-empty strings/lists, booleans; errors are false. */
export function isTruthy(v: Value): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (v.kind === 'list') return v.items.length > 0;
  if (v.kind === 'divert') return true;
  return false;
}

/** Stringification used by interpolation (F446) and transcripts. */
export function valueToString(v: Value): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v.kind === 'list') return v.items.map(valueToString).join(', ');
  if (v.kind === 'divert') return `-> ${v.name}`;
  return `(error: ${v.message})`;
}

/** Numeric coercion for arithmetic; booleans are 0/1. */
export function asNumber(v: Value): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

// ── JSON state encoding (F448) ───────────────────────────────────────────────

export type JsonValue =
  | number
  | string
  | boolean
  | { $list: JsonValue[]; origin?: string }
  | { $divert: string }
  | { $error: string };

export function valueToJson(v: Value): JsonValue {
  if (typeof v !== 'object') return v;
  if (v.kind === 'list') {
    return {
      $list: v.items.map(valueToJson),
      ...(v.origin !== undefined ? { origin: v.origin } : {}),
    };
  }
  if (v.kind === 'divert') return { $divert: v.name };
  return { $error: v.message };
}

export function valueFromJson(j: JsonValue, resolveContainer: (name: string) => number): Value {
  if (typeof j !== 'object') return j;
  if ('$list' in j) {
    return makeList(
      j.$list.map((e) => valueFromJson(e, resolveContainer)),
      j.origin,
    );
  }
  if ('$divert' in j) {
    return { kind: 'divert', container: resolveContainer(j.$divert), name: j.$divert };
  }
  return errorValue(j.$error);
}
