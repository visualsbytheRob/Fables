/**
 * Automation rules repository (Epic 20, F1911–F1918).
 *
 * Persists rules (migration 040) and runs them: a rule is evaluated by the pure
 * engine, and when it fires the plan is applied to the note (tags/title/move) in
 * one transaction with a logged diff. Cascade protection caps how many rules can
 * fire for one event; disable-on-error parks a misbehaving rule.
 */

import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';
import type { NoteId, NotebookId, TagId } from '@fables/core';
import { notesRepo } from './notes.js';
import { tagsRepo } from './tags.js';
import {
  evaluateRule,
  applyPlanToNote,
  type Rule,
  type RuleAction,
  type RuleCondition,
  type TriggerType,
  type NoteEvent,
} from '../../automation/engine.js';

const MAX_RULES_PER_EVENT = 50;

export interface AutomationRule {
  id: string;
  name: string;
  trigger: TriggerType;
  conditions: RuleCondition[];
  actions: RuleAction[];
  enabled: boolean;
  runCount: number;
  lastRun: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RuleRow {
  id: string;
  name: string;
  trigger: string;
  conditions: string;
  actions: string;
  enabled: number;
  run_count: number;
  last_run: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function parse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const toRule = (r: RuleRow): AutomationRule => ({
  id: r.id,
  name: r.name,
  trigger: r.trigger as TriggerType,
  conditions: parse<RuleCondition[]>(r.conditions, []),
  actions: parse<RuleAction[]>(r.actions, []),
  enabled: r.enabled === 1,
  runCount: r.run_count,
  lastRun: r.last_run,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface RuleInput {
  name: string;
  trigger: TriggerType;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
  enabled?: boolean;
}

export interface RunResult {
  fired: boolean;
  dryRun: boolean;
  conditionResults: { condition: RuleCondition; passed: boolean }[];
  diff: { tags?: { added: string[]; removed: string[] }; title?: string; notebookId?: string };
  notifications: string[];
}

export function automationRepo(db: Db) {
  const notes = notesRepo(db);
  const tags = tagsRepo(db);

  const asRule = (r: AutomationRule): Rule => ({
    trigger: r.trigger,
    conditions: r.conditions,
    actions: r.actions,
    enabled: r.enabled,
  });

  /** Build a NoteEvent from a stored note. */
  const noteEvent = (noteId: string, trigger: TriggerType): NoteEvent | null => {
    const note = notes.get(noteId as NoteId);
    if (!note) return null;
    return {
      trigger,
      note: {
        id: note.id,
        title: note.title,
        body: note.body,
        tags: tags.tagsForNote(note.id).map((t) => t.name),
        notebookId: note.notebookId,
      },
    };
  };

  const repo = {
    create(input: RuleInput): AutomationRule {
      const now = nowIso();
      const rule: AutomationRule = {
        id: `rule_${crypto.randomUUID()}`,
        name: input.name,
        trigger: input.trigger,
        conditions: input.conditions ?? [],
        actions: input.actions ?? [],
        enabled: input.enabled ?? true,
        runCount: 0,
        lastRun: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO automation_rules (id, name, trigger, conditions, actions, enabled, run_count, last_run, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)`,
      ).run(
        rule.id,
        rule.name,
        rule.trigger,
        JSON.stringify(rule.conditions),
        JSON.stringify(rule.actions),
        rule.enabled ? 1 : 0,
        now,
        now,
      );
      return rule;
    },

    get(id: string): AutomationRule | null {
      const row = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(id) as
        | RuleRow
        | undefined;
      return row ? toRule(row) : null;
    },

    list(): AutomationRule[] {
      return (db.prepare('SELECT * FROM automation_rules ORDER BY name').all() as RuleRow[]).map(
        toRule,
      );
    },

    update(
      id: string,
      patch: { [K in keyof RuleInput]?: RuleInput[K] | undefined },
    ): AutomationRule | null {
      const cur = this.get(id);
      if (!cur) return null;
      const next: AutomationRule = {
        ...cur,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
        ...(patch.conditions !== undefined ? { conditions: patch.conditions } : {}),
        ...(patch.actions !== undefined ? { actions: patch.actions } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        error: patch.enabled === true ? null : cur.error,
        updatedAt: nowIso(),
      };
      db.prepare(
        `UPDATE automation_rules SET name = ?, trigger = ?, conditions = ?, actions = ?, enabled = ?, error = ?, updated_at = ? WHERE id = ?`,
      ).run(
        next.name,
        next.trigger,
        JSON.stringify(next.conditions),
        JSON.stringify(next.actions),
        next.enabled ? 1 : 0,
        next.error,
        next.updatedAt,
        id,
      );
      return next;
    },

    remove(id: string): boolean {
      return db.prepare('DELETE FROM automation_rules WHERE id = ?').run(id).changes > 0;
    },

    /** Run one rule against a note (F1914 dry-run when dryRun=true). */
    run(ruleId: string, noteId: string, dryRun = false): RunResult | null {
      const rule = this.get(ruleId);
      if (!rule) return null;
      const event = noteEvent(noteId, rule.trigger);
      if (!event) return null;
      const match = evaluateRule(asRule(rule), event);
      const effect = applyPlanToNote(event.note, match.plan);

      const beforeTags = new Set(event.note.tags);
      const afterTags = new Set(effect.tags);
      const added = [...afterTags].filter((t) => !beforeTags.has(t));
      const removed = [...beforeTags].filter((t) => !afterTags.has(t));
      const diff: RunResult['diff'] = {};
      if (added.length > 0 || removed.length > 0) diff.tags = { added, removed };
      if (effect.title !== event.note.title) diff.title = effect.title;
      if (effect.notebookId !== event.note.notebookId) diff.notebookId = effect.notebookId;

      if (match.fired && !dryRun) {
        const tx = db.transaction(() => {
          // Apply tag changes.
          for (const name of added) {
            tags.linkNote(noteId as NoteId, tags.ensure(name).id, false);
          }
          for (const name of removed) {
            const t = tags.getByName(name);
            if (t) {
              db.prepare('DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?').run(
                noteId,
                t.id as TagId,
              );
            }
          }
          // Apply title/notebook in one note update (optimistic-concurrency safe).
          if (diff.title !== undefined || diff.notebookId !== undefined) {
            const note = notes.get(noteId as NoteId);
            if (note) {
              notes.update(noteId as NoteId, note.rev, {
                ...(diff.title !== undefined ? { title: diff.title } : {}),
                ...(diff.notebookId !== undefined
                  ? { notebookId: diff.notebookId as NotebookId }
                  : {}),
              });
            }
          }
          db.prepare(
            'UPDATE automation_rules SET run_count = run_count + 1, last_run = ? WHERE id = ?',
          ).run(nowIso(), ruleId);
        });
        tx();
      }

      db.prepare(
        `INSERT INTO rule_runs (id, rule_id, note_id, fired, plan, diff, dry_run, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `run_${crypto.randomUUID()}`,
        ruleId,
        noteId,
        match.fired ? 1 : 0,
        JSON.stringify(match.plan),
        JSON.stringify(diff),
        dryRun ? 1 : 0,
        nowIso(),
      );

      return {
        fired: match.fired,
        dryRun,
        conditionResults: match.conditionResults,
        diff,
        notifications: effect.notifications,
      };
    },

    /** Run all enabled rules matching an event's trigger (cascade-capped, F1916). */
    runForEvent(noteId: string, trigger: TriggerType): RunResult[] {
      const matching = this.list().filter((r) => r.enabled && r.trigger === trigger);
      const results: RunResult[] = [];
      for (const rule of matching.slice(0, MAX_RULES_PER_EVENT)) {
        const r = this.run(rule.id, noteId, false);
        if (r) results.push(r);
      }
      return results;
    },

    /** Disable a rule after an error, recording why (F1918). */
    disableOnError(ruleId: string, error: string): void {
      db.prepare(
        'UPDATE automation_rules SET enabled = 0, error = ?, updated_at = ? WHERE id = ?',
      ).run(error, nowIso(), ruleId);
    },

    runHistory(
      ruleId: string,
      limit = 100,
    ): {
      id: string;
      noteId: string;
      fired: boolean;
      diff: unknown;
      dryRun: boolean;
      createdAt: string;
    }[] {
      return (
        db
          .prepare('SELECT * FROM rule_runs WHERE rule_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(ruleId, limit) as {
          id: string;
          note_id: string;
          fired: number;
          diff: string;
          dry_run: number;
          created_at: string;
        }[]
      ).map((r) => ({
        id: r.id,
        noteId: r.note_id,
        fired: r.fired === 1,
        diff: parse<unknown>(r.diff, {}),
        dryRun: r.dry_run === 1,
        createdAt: r.created_at,
      }));
    },
  };

  return repo;
}

export type AutomationRepo = ReturnType<typeof automationRepo>;
