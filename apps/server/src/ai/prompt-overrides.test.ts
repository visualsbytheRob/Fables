/**
 * Prompt-override resolver tests (F1317).
 */

import { describe, expect, it } from 'vitest';
import {
  isTemplateId,
  listEffectivePrompts,
  resolvePrompt,
  validateOverride,
} from './prompt-overrides.js';

describe('prompt overrides', () => {
  it('recognises known template ids', () => {
    expect(isTemplateId('summarize')).toBe(true);
    expect(isTemplateId('not-a-template')).toBe(false);
  });

  it('returns the built-in when no override is set', () => {
    const eff = resolvePrompt('summarize', null);
    expect(eff?.overridden).toBe(false);
    expect(eff?.system.length).toBeGreaterThan(0);
  });

  it('merges an override over the default', () => {
    const eff = resolvePrompt('summarize', { system: 'Custom system prompt.' });
    expect(eff?.system).toBe('Custom system prompt.');
    expect(eff?.overridden).toBe(true);
    // Template body untouched.
    expect(eff?.template).toContain('{{body}}');
  });

  it('validates that an override keeps the required slots', () => {
    const ok = validateOverride('summarize', { template: 'Sum up "{{title}}":\n{{body}}' });
    expect(ok.ok).toBe(true);

    const missing = validateOverride('summarize', { template: 'No slots here' });
    expect(missing.ok).toBe(false);

    const extra = validateOverride('summarize', {
      template: '{{title}} {{body}} {{bogus}}',
    });
    expect(extra.ok).toBe(false);
  });

  it('rejects an unknown template id', () => {
    const r = validateOverride('nope', { system: 'x' });
    expect(r.ok).toBe(false);
  });

  it('lists every template with effective values', () => {
    const list = listEffectivePrompts(new Map([['summarize', { system: 'Overridden.' }]]));
    expect(list.length).toBeGreaterThan(5);
    const summarize = list.find((p) => p.id === 'summarize');
    expect(summarize?.system).toBe('Overridden.');
    expect(summarize?.overridden).toBe(true);
  });
});
