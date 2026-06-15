/**
 * User-editable prompt overrides (F1317).
 *
 * Lets the user replace the built-in `system` and/or `template` strings of any
 * prompt template, keyed by its template id. This module is the pure resolver:
 * it lists the overridable templates with their effective values and merges a
 * stored override over the built-in default. Persistence lives in the repo.
 */

import { TEMPLATES, type TemplateId } from './templates.js';

export interface PromptOverride {
  /** Replacement system prompt; omitted keeps the built-in. */
  system?: string | undefined;
  /** Replacement template body (must keep the same {{slots}}); omitted keeps the built-in. */
  template?: string | undefined;
}

export interface EffectivePrompt {
  id: TemplateId;
  system: string;
  template: string;
  slots: readonly string[];
  /** True when an override is currently applied. */
  overridden: boolean;
}

interface BaseTemplate {
  id: string;
  system: string;
  template: string;
  slots: readonly string[];
}

const ALL = Object.values(TEMPLATES) as unknown as BaseTemplate[];

const byId = new Map<string, BaseTemplate>(ALL.map((t) => [t.id, t]));

export function isTemplateId(id: string): id is TemplateId {
  return byId.has(id);
}

/** The set of `{{slots}}` referenced by a template body. */
function slotsOf(template: string): Set<string> {
  return new Set([...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!));
}

/**
 * Validate that an override's template body keeps exactly the declared slots —
 * an override that drops or invents a slot would break rendering.
 */
export function validateOverride(
  id: string,
  override: PromptOverride,
): { ok: true } | { ok: false; error: string } {
  const base = byId.get(id);
  if (!base) return { ok: false, error: `unknown template "${id}"` };
  if (override.template !== undefined) {
    const want = new Set(base.slots);
    const got = slotsOf(override.template);
    for (const s of want) {
      if (!got.has(s)) return { ok: false, error: `override is missing required slot "{{${s}}}"` };
    }
    for (const s of got) {
      if (!want.has(s)) return { ok: false, error: `override uses unknown slot "{{${s}}}"` };
    }
  }
  return { ok: true };
}

/** Merge a stored override over the built-in template (F1317). */
export function resolvePrompt(id: string, override: PromptOverride | null): EffectivePrompt | null {
  const base = byId.get(id);
  if (!base) return null;
  return {
    id: base.id as TemplateId,
    system: override?.system ?? base.system,
    template: override?.template ?? base.template,
    slots: base.slots,
    overridden:
      override !== null && (override.system !== undefined || override.template !== undefined),
  };
}

/** All templates with their effective values, given a map of stored overrides. */
export function listEffectivePrompts(overrides: Map<string, PromptOverride>): EffectivePrompt[] {
  return ALL.map((t) => resolvePrompt(t.id, overrides.get(t.id) ?? null)!).sort((a, b) =>
    a.id < b.id ? -1 : 1,
  );
}
