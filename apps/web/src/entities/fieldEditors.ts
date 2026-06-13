/**
 * Pure helpers backing the schema-driven entity field editor (F603/F604).
 *
 * Each schema field has a `fieldType` of number | string | bool | list. The
 * editor renders a control per field, formats its stored value into the raw
 * string/checkbox state the control shows, and parses the user's raw input back
 * into the typed value the API stores in `entity.fields`. `defaultsFor` seeds a
 * create form from a schema's per-field `default` values (templates-from-schema).
 */
import type { EntityFieldDef, EntityFieldType, EntityTypeSchema } from '../api/client.js';

/**
 * Parse a control's raw input into the typed value for its field.
 *
 * - number → finite number, or `null` when blank/unparseable
 * - string → the raw text (trimmed of surrounding whitespace only when empty)
 * - bool   → boolean (accepts the checkbox boolean or "true"/"1"/"yes")
 * - list   → string[] or number[] split on commas/newlines, blanks dropped; a
 *            list whose every entry is numeric becomes number[]
 */
export function parseFieldInput(fieldType: EntityFieldType, raw: unknown): unknown {
  switch (fieldType) {
    case 'number': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
      const text = String(raw ?? '').trim();
      if (text === '') return null;
      const n = Number(text);
      return Number.isFinite(n) ? n : null;
    }
    case 'bool': {
      if (typeof raw === 'boolean') return raw;
      const text = String(raw ?? '').trim().toLowerCase();
      return text === 'true' || text === '1' || text === 'yes' || text === 'on';
    }
    case 'list': {
      const items = parseListItems(raw);
      // Promote to number[] only when every item parses as a finite number.
      const nums = items.map((s) => Number(s));
      if (items.length > 0 && nums.every((n) => Number.isFinite(n) && n.toString() !== 'NaN')) {
        // Guard the empty-string-to-0 coercion: only numeric-looking items.
        if (items.every((s) => s !== '' && Number.isFinite(Number(s)))) return nums;
      }
      return items;
    }
    case 'string':
    default: {
      const text = String(raw ?? '');
      return text;
    }
  }
}

/** Split a raw list editor value (comma- and/or newline-separated) into trimmed, non-empty items. */
export function parseListItems(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter((s) => s !== '');
  return String(raw ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Format a stored field value for display inside a control or summary.
 * Lists render as comma-separated; null/undefined render as the empty string.
 */
export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((x) => String(x)).join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * Seed a create form from a schema (F604): each field maps to its `default`
 * when present, else a type-appropriate empty value (0 / '' / false / []).
 */
export function defaultsFor(schema: EntityTypeSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of schema.fields) {
    out[field.name] = field.default !== undefined ? field.default : emptyValueFor(field.fieldType);
  }
  return out;
}

/** The neutral empty value for a field type, used when a schema field has no default. */
export function emptyValueFor(fieldType: EntityFieldType): unknown {
  switch (fieldType) {
    case 'number':
      return null;
    case 'bool':
      return false;
    case 'list':
      return [];
    case 'string':
    default:
      return '';
  }
}

/** A one-line summary of an entity's first few fields for a gallery card (F607). */
export function fieldSummary(
  fields: Record<string, unknown>,
  defs: EntityFieldDef[],
  limit = 3,
): string {
  const parts: string[] = [];
  for (const def of defs) {
    if (parts.length >= limit) break;
    const value = fields[def.name];
    const text = formatFieldValue(value);
    if (text !== '' && text !== 'false') parts.push(`${def.name}: ${text}`);
  }
  return parts.join(' · ');
}
