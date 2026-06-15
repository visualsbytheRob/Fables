import { describe, it, expect } from 'vitest';
import {
  evaluateRule,
  applyPlanToNote,
  type Rule,
  type NoteEvent,
  type RuleCondition,
  type RuleAction,
} from './engine.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNote(overrides: Partial<NoteEvent['note']> = {}): NoteEvent['note'] {
  return {
    id: 'note-1',
    title: 'Hello World',
    body: 'This is the body of the note with several words',
    tags: ['inbox', 'draft'],
    notebookId: 'nb-1',
    ...overrides,
  };
}

function makeEvent(
  trigger: NoteEvent['trigger'] = 'note.created',
  noteOverrides: Partial<NoteEvent['note']> = {},
): NoteEvent {
  return { trigger, note: makeNote(noteOverrides) };
}

function makeRule(partial: Partial<Rule> & Pick<Rule, 'trigger'>): Rule {
  return {
    conditions: [],
    actions: [],
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Trigger matching
// ---------------------------------------------------------------------------

describe('trigger mismatch', () => {
  it('does not fire when event trigger differs from rule trigger', () => {
    const rule = makeRule({ trigger: 'note.updated' });
    const event = makeEvent('note.created');
    const result = evaluateRule(rule, event);
    expect(result.fired).toBe(false);
    expect(result.plan).toEqual([]);
  });

  it('fires on matching trigger with no conditions', () => {
    const rule = makeRule({ trigger: 'note.created' });
    const event = makeEvent('note.created');
    const result = evaluateRule(rule, event);
    expect(result.fired).toBe(true);
  });

  it('fires for schedule trigger', () => {
    const rule = makeRule({ trigger: 'schedule' });
    const event = makeEvent('schedule');
    expect(evaluateRule(rule, event).fired).toBe(true);
  });

  it('fires for manual trigger', () => {
    const rule = makeRule({ trigger: 'manual' });
    const event = makeEvent('manual');
    expect(evaluateRule(rule, event).fired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Enabled flag
// ---------------------------------------------------------------------------

describe('enabled flag', () => {
  it('disabled rule never fires even when trigger and conditions match', () => {
    const rule = makeRule({ trigger: 'note.created', enabled: false });
    const event = makeEvent('note.created');
    const result = evaluateRule(rule, event);
    expect(result.fired).toBe(false);
    expect(result.plan).toEqual([]);
  });

  it('fires when enabled is explicitly true', () => {
    const rule = makeRule({ trigger: 'note.created', enabled: true });
    const event = makeEvent('note.created');
    expect(evaluateRule(rule, event).fired).toBe(true);
  });

  it('fires when enabled is absent (undefined)', () => {
    const rule = makeRule({ trigger: 'note.created' });
    expect(rule.enabled).toBeUndefined();
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// String condition ops
// ---------------------------------------------------------------------------

describe('condition: equals', () => {
  it('passes when title exactly matches', () => {
    const condition: RuleCondition = {
      field: 'title',
      op: 'equals',
      value: 'Hello World',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    const result = evaluateRule(rule, makeEvent('note.created'));
    expect(result.fired).toBe(true);
    expect(result.conditionResults[0]!.passed).toBe(true);
  });

  it('fails when title does not exactly match', () => {
    const condition: RuleCondition = {
      field: 'title',
      op: 'equals',
      value: 'hello world',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    const result = evaluateRule(rule, makeEvent('note.created'));
    expect(result.fired).toBe(false);
    expect(result.conditionResults[0]!.passed).toBe(false);
  });
});

describe('condition: contains', () => {
  it('passes when body contains the value', () => {
    const condition: RuleCondition = {
      field: 'body',
      op: 'contains',
      value: 'body of the note',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(true);
  });

  it('fails when body does not contain the value', () => {
    const condition: RuleCondition = {
      field: 'body',
      op: 'contains',
      value: 'not present',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(false);
  });
});

describe('condition: matches (regex)', () => {
  it('passes when title matches a valid regex', () => {
    const condition: RuleCondition = {
      field: 'title',
      op: 'matches',
      value: '^Hello',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(true);
  });

  it('fails when title does not match the regex', () => {
    const condition: RuleCondition = {
      field: 'title',
      op: 'matches',
      value: '^Goodbye',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(false);
  });

  it('fails gracefully on an invalid regex without throwing', () => {
    const condition: RuleCondition = {
      field: 'title',
      op: 'matches',
      value: '[invalid(regex',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    let result: ReturnType<typeof evaluateRule> | undefined;
    expect(() => {
      result = evaluateRule(rule, makeEvent('note.created'));
    }).not.toThrow();
    expect(result!.conditionResults[0]!.passed).toBe(false);
    expect(result!.fired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Numeric ops
// ---------------------------------------------------------------------------

describe('condition: gt / lt on wordCount', () => {
  // body = 'This is the body of the note with several words' = 9 words
  it('passes gt when wordCount exceeds threshold', () => {
    const condition: RuleCondition = {
      field: 'wordCount',
      op: 'gt',
      value: 5,
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(true);
  });

  it('fails gt when wordCount does not exceed threshold', () => {
    const condition: RuleCondition = {
      field: 'wordCount',
      op: 'gt',
      value: 100,
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(false);
  });

  it('passes lt when wordCount is below threshold', () => {
    const condition: RuleCondition = {
      field: 'wordCount',
      op: 'lt',
      value: 50,
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(true);
  });

  it('fails lt when wordCount is not below threshold', () => {
    const condition: RuleCondition = {
      field: 'wordCount',
      op: 'lt',
      value: 5,
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(false);
  });

  it('counts zero words for empty body', () => {
    const condition: RuleCondition = {
      field: 'wordCount',
      op: 'lt',
      value: 1,
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    const event = makeEvent('note.created', { body: '' });
    expect(evaluateRule(rule, event).fired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tag ops
// ---------------------------------------------------------------------------

describe('condition: hasTag / lacksTag', () => {
  it('hasTag passes when tag is present', () => {
    const condition: RuleCondition = {
      field: 'tags',
      op: 'hasTag',
      value: 'inbox',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(true);
  });

  it('hasTag fails when tag is absent', () => {
    const condition: RuleCondition = {
      field: 'tags',
      op: 'hasTag',
      value: 'published',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(false);
  });

  it('lacksTag passes when tag is absent', () => {
    const condition: RuleCondition = {
      field: 'tags',
      op: 'lacksTag',
      value: 'published',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(true);
  });

  it('lacksTag fails when tag is present', () => {
    const condition: RuleCondition = {
      field: 'tags',
      op: 'lacksTag',
      value: 'draft',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(false);
  });
});

describe('condition: field=tag op=equals alias for hasTag', () => {
  it('fires when note has the tag specified via field:tag equals', () => {
    const condition: RuleCondition = {
      field: 'tag',
      op: 'equals',
      value: 'inbox',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(true);
  });

  it('does not fire when note lacks the tag specified via field:tag equals', () => {
    const condition: RuleCondition = {
      field: 'tag',
      op: 'equals',
      value: 'published',
    };
    const rule = makeRule({ trigger: 'note.created', conditions: [condition] });
    expect(evaluateRule(rule, makeEvent('note.created')).fired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multi-condition AND
// ---------------------------------------------------------------------------

describe('multi-condition AND logic', () => {
  it('fires only when all conditions pass', () => {
    const conditions: RuleCondition[] = [
      { field: 'title', op: 'contains', value: 'Hello' },
      { field: 'body', op: 'contains', value: 'body' },
    ];
    const rule = makeRule({ trigger: 'note.created', conditions });
    const result = evaluateRule(rule, makeEvent('note.created'));
    expect(result.fired).toBe(true);
    expect(result.conditionResults).toHaveLength(2);
    expect(result.conditionResults[0]!.passed).toBe(true);
    expect(result.conditionResults[1]!.passed).toBe(true);
  });

  it('does not fire when one condition fails, and conditionResults reflect each result', () => {
    const conditions: RuleCondition[] = [
      { field: 'title', op: 'contains', value: 'Hello' },
      { field: 'title', op: 'contains', value: 'Nonexistent' },
    ];
    const rule = makeRule({ trigger: 'note.created', conditions });
    const result = evaluateRule(rule, makeEvent('note.created'));
    expect(result.fired).toBe(false);
    expect(result.plan).toEqual([]);
    expect(result.conditionResults[0]!.passed).toBe(true);
    expect(result.conditionResults[1]!.passed).toBe(false);
  });

  it('returns conditionResults even when trigger does not match', () => {
    const conditions: RuleCondition[] = [{ field: 'title', op: 'equals', value: 'Hello World' }];
    const rule = makeRule({ trigger: 'note.updated', conditions });
    const result = evaluateRule(rule, makeEvent('note.created'));
    expect(result.fired).toBe(false);
    expect(result.conditionResults).toHaveLength(1);
    // Condition itself passes (title matches), but trigger mismatch => fired=false
    expect(result.conditionResults[0]!.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Plan in result
// ---------------------------------------------------------------------------

describe('plan in RuleMatch', () => {
  it('plan contains rule actions when fired', () => {
    const actions: RuleAction[] = [
      { type: 'addTag', tag: 'reviewed' },
      { type: 'notify', message: 'Done' },
    ];
    const rule = makeRule({ trigger: 'note.created', actions });
    const result = evaluateRule(rule, makeEvent('note.created'));
    expect(result.fired).toBe(true);
    expect(result.plan).toEqual(actions);
  });

  it('plan is empty when rule does not fire', () => {
    const actions: RuleAction[] = [{ type: 'addTag', tag: 'reviewed' }];
    const rule = makeRule({ trigger: 'note.updated', actions });
    const result = evaluateRule(rule, makeEvent('note.created'));
    expect(result.plan).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyPlanToNote
// ---------------------------------------------------------------------------

describe('applyPlanToNote', () => {
  it('addTag appends a new tag', () => {
    const note = makeNote();
    const effect = applyPlanToNote(note, [{ type: 'addTag', tag: 'reviewed' }]);
    expect(effect.tags).toContain('reviewed');
    expect(effect.tags).toContain('inbox');
  });

  it('addTag does not duplicate an existing tag', () => {
    const note = makeNote();
    const effect = applyPlanToNote(note, [
      { type: 'addTag', tag: 'inbox' },
      { type: 'addTag', tag: 'inbox' },
    ]);
    expect(effect.tags.filter((t) => t === 'inbox')).toHaveLength(1);
  });

  it('removeTag removes the specified tag', () => {
    const note = makeNote();
    const effect = applyPlanToNote(note, [{ type: 'removeTag', tag: 'draft' }]);
    expect(effect.tags).not.toContain('draft');
    expect(effect.tags).toContain('inbox');
  });

  it('move sets notebookId', () => {
    const note = makeNote();
    const effect = applyPlanToNote(note, [{ type: 'move', notebookId: 'nb-archive' }]);
    expect(effect.notebookId).toBe('nb-archive');
  });

  it('setTitle sets title', () => {
    const note = makeNote();
    const effect = applyPlanToNote(note, [{ type: 'setTitle', title: 'New Title' }]);
    expect(effect.title).toBe('New Title');
  });

  it('notify collects messages', () => {
    const note = makeNote();
    const effect = applyPlanToNote(note, [
      { type: 'notify', message: 'First' },
      { type: 'notify', message: 'Second' },
    ]);
    expect(effect.notifications).toEqual(['First', 'Second']);
  });

  it('runPlugin collects plugin calls with args', () => {
    const note = makeNote();
    const effect = applyPlanToNote(note, [
      { type: 'runPlugin', plugin: 'summarize', args: { length: 'short' } },
    ]);
    expect(effect.pluginCalls).toHaveLength(1);
    expect(effect.pluginCalls[0]!.plugin).toBe('summarize');
    expect(effect.pluginCalls[0]!.args).toEqual({ length: 'short' });
  });

  it('runPlugin with no args defaults to empty object', () => {
    const note = makeNote();
    const effect = applyPlanToNote(note, [{ type: 'runPlugin', plugin: 'no-args-plugin' }]);
    expect(effect.pluginCalls[0]!.args).toEqual({});
  });

  it('applies multiple actions in sequence', () => {
    const note = makeNote();
    const plan: RuleAction[] = [
      { type: 'addTag', tag: 'published' },
      { type: 'removeTag', tag: 'draft' },
      { type: 'move', notebookId: 'nb-published' },
      { type: 'setTitle', title: 'Published Note' },
      { type: 'notify', message: 'Note published' },
    ];
    const effect = applyPlanToNote(note, plan);
    expect(effect.tags).toContain('published');
    expect(effect.tags).not.toContain('draft');
    expect(effect.notebookId).toBe('nb-published');
    expect(effect.title).toBe('Published Note');
    expect(effect.notifications).toEqual(['Note published']);
  });

  it('does not mutate the original note', () => {
    const note = makeNote();
    const originalTags = [...note.tags];
    applyPlanToNote(note, [
      { type: 'addTag', tag: 'extra' },
      { type: 'removeTag', tag: 'inbox' },
    ]);
    expect(note.tags).toEqual(originalTags);
  });
});
