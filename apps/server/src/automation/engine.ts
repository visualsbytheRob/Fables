/**
 * Rule-engine evaluation core.
 *
 * Pure, no I/O. The engine decides WHAT should happen; callers persist/execute.
 */

export type TriggerType = 'note.created' | 'note.updated' | 'note.tagged' | 'schedule' | 'manual';

export interface RuleCondition {
  /**
   * Field on the note to test:
   * 'title' | 'body' | 'tag' | 'notebookId' | 'wordCount'
   */
  field: string;
  op: 'equals' | 'contains' | 'matches' | 'gt' | 'lt' | 'hasTag' | 'lacksTag';
  value: string | number;
}

export type RuleAction =
  | { type: 'addTag'; tag: string }
  | { type: 'removeTag'; tag: string }
  | { type: 'move'; notebookId: string }
  | { type: 'setTitle'; title: string }
  | { type: 'notify'; message: string }
  | { type: 'runPlugin'; plugin: string; args?: Record<string, unknown> | undefined };

export interface Rule {
  trigger: TriggerType;
  /** All conditions must hold (AND). Empty = always matches. */
  conditions: RuleCondition[];
  actions: RuleAction[];
  /** When false the rule never fires. */
  enabled?: boolean | undefined;
}

export interface NoteEvent {
  trigger: TriggerType;
  note: {
    id: string;
    title: string;
    body: string;
    tags: string[];
    notebookId: string;
  };
}

export interface RuleMatch {
  fired: boolean;
  /** Concrete actions to apply when fired (a copy of rule.actions; may be empty). */
  plan: RuleAction[];
  /** Per-condition evaluation, for a dry-run/why view. */
  conditionResults: { condition: RuleCondition; passed: boolean }[];
}

export interface PlanEffect {
  tags: string[];
  title: string;
  notebookId: string;
  notifications: string[];
  pluginCalls: { plugin: string; args: Record<string, unknown> }[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function wordCount(body: string): number {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function getStringField(note: NoteEvent['note'], field: string): string | undefined {
  switch (field) {
    case 'title':
      return note.title;
    case 'body':
      return note.body;
    case 'notebookId':
      return note.notebookId;
    default:
      return undefined;
  }
}

function evaluateCondition(condition: RuleCondition, note: NoteEvent['note']): boolean {
  const { field, op, value } = condition;

  // hasTag / lacksTag — value must be a string
  if (op === 'hasTag') {
    return typeof value === 'string' && note.tags.includes(value);
  }
  if (op === 'lacksTag') {
    return typeof value === 'string' && !note.tags.includes(value);
  }

  // 'tag' field + 'equals' is an alias for hasTag
  if (field === 'tag' && op === 'equals') {
    return typeof value === 'string' && note.tags.includes(value);
  }

  // gt / lt — numeric fields
  if (op === 'gt' || op === 'lt') {
    let numeric: number;
    if (field === 'wordCount') {
      numeric = wordCount(note.body);
    } else {
      const raw = getStringField(note, field);
      if (raw === undefined) return false;
      numeric = Number(raw);
      if (Number.isNaN(numeric)) return false;
    }
    const threshold = Number(value);
    if (Number.isNaN(threshold)) return false;
    return op === 'gt' ? numeric > threshold : numeric < threshold;
  }

  // String ops: equals / contains / matches
  const strVal = getStringField(note, field);
  if (strVal === undefined) return false;

  if (op === 'equals') {
    return strVal === String(value);
  }
  if (op === 'contains') {
    return strVal.includes(String(value));
  }
  if (op === 'matches') {
    try {
      const re = new RegExp(String(value));
      return re.test(strVal);
    } catch {
      // Invalid regex — condition fails, never throws
      return false;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a rule against a note event and return whether it fires plus the
 * concrete action plan and per-condition debug info.
 */
export function evaluateRule(rule: Rule, event: NoteEvent): RuleMatch {
  const conditionResults = rule.conditions.map((condition) => ({
    condition,
    passed: evaluateCondition(condition, event.note),
  }));

  const enabled = rule.enabled !== false;
  const triggerMatches = rule.trigger === event.trigger;
  const allConditionsPassed = conditionResults.every((r) => r.passed);

  const fired = enabled && triggerMatches && allConditionsPassed;

  return {
    fired,
    plan: fired ? [...rule.actions] : [],
    conditionResults,
  };
}

/**
 * Purely compute the resulting note fields + collected messages from an action
 * plan. No I/O — lets callers preview the effect.
 */
export function applyPlanToNote(note: NoteEvent['note'], plan: RuleAction[]): PlanEffect {
  let tags = [...note.tags];
  let title = note.title;
  let notebookId = note.notebookId;
  const notifications: string[] = [];
  const pluginCalls: { plugin: string; args: Record<string, unknown> }[] = [];

  for (const action of plan) {
    switch (action.type) {
      case 'addTag':
        if (!tags.includes(action.tag)) {
          tags.push(action.tag);
        }
        break;
      case 'removeTag':
        tags = tags.filter((t) => t !== action.tag);
        break;
      case 'move':
        notebookId = action.notebookId;
        break;
      case 'setTitle':
        title = action.title;
        break;
      case 'notify':
        notifications.push(action.message);
        break;
      case 'runPlugin': {
        const args: Record<string, unknown> = action.args !== undefined ? { ...action.args } : {};
        pluginCalls.push({ plugin: action.plugin, args });
        break;
      }
    }
  }

  return { tags, title, notebookId, notifications, pluginCalls };
}
