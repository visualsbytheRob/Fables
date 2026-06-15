/**
 * AI runtime persistence (F1316–F1317).
 *
 * Two small stores backed by migration 047: a local prompt/response log (off by
 * default — only written when the caller opts in via AI settings) and a map of
 * user prompt-template overrides. Both are inspectable and clearable; neither
 * ever leaves the machine.
 */

import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';
import type { PromptOverride } from '../../ai/prompt-overrides.js';

export interface PromptLogEntry {
  id: string;
  feature: string;
  model: string;
  prompt: string;
  response: string;
  tokens: number;
  durationMs: number;
  createdAt: string;
}

interface LogRow {
  id: string;
  feature: string;
  model: string;
  prompt: string;
  response: string;
  tokens: number;
  duration_ms: number;
  created_at: string;
}

const toEntry = (r: LogRow): PromptLogEntry => ({
  id: r.id,
  feature: r.feature,
  model: r.model,
  prompt: r.prompt,
  response: r.response,
  tokens: r.tokens,
  durationMs: r.duration_ms,
  createdAt: r.created_at,
});

export function aiRuntimeRepo(db: Db) {
  return {
    // ── Prompt log (F1316) ──
    logPrompt(entry: {
      feature: string;
      model?: string;
      prompt: string;
      response: string;
      tokens?: number;
      durationMs?: number;
    }): PromptLogEntry {
      const row: PromptLogEntry = {
        id: `ailog_${crypto.randomUUID()}`,
        feature: entry.feature,
        model: entry.model ?? '',
        prompt: entry.prompt,
        response: entry.response,
        tokens: entry.tokens ?? 0,
        durationMs: entry.durationMs ?? 0,
        createdAt: nowIso(),
      };
      db.prepare(
        `INSERT INTO ai_prompt_log (id, feature, model, prompt, response, tokens, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id,
        row.feature,
        row.model,
        row.prompt,
        row.response,
        row.tokens,
        row.durationMs,
        row.createdAt,
      );
      return row;
    },

    listLog(limit = 100): PromptLogEntry[] {
      return (
        db
          .prepare('SELECT * FROM ai_prompt_log ORDER BY created_at DESC LIMIT ?')
          .all(limit) as LogRow[]
      ).map(toEntry);
    },

    clearLog(): number {
      return db.prepare('DELETE FROM ai_prompt_log').run().changes;
    },

    // ── Prompt overrides (F1317) ──
    getOverride(templateId: string): PromptOverride | null {
      const row = db
        .prepare('SELECT template FROM ai_prompt_overrides WHERE template_id = ?')
        .get(templateId) as { template: string } | undefined;
      if (!row) return null;
      try {
        return JSON.parse(row.template) as PromptOverride;
      } catch {
        return null;
      }
    },

    allOverrides(): Map<string, PromptOverride> {
      const rows = db.prepare('SELECT template_id, template FROM ai_prompt_overrides').all() as {
        template_id: string;
        template: string;
      }[];
      const map = new Map<string, PromptOverride>();
      for (const r of rows) {
        try {
          map.set(r.template_id, JSON.parse(r.template) as PromptOverride);
        } catch {
          /* skip malformed */
        }
      }
      return map;
    },

    setOverride(templateId: string, override: PromptOverride): void {
      db.prepare(
        `INSERT INTO ai_prompt_overrides (template_id, template, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(template_id) DO UPDATE SET template = excluded.template, updated_at = excluded.updated_at`,
      ).run(templateId, JSON.stringify(override), nowIso());
    },

    clearOverride(templateId: string): boolean {
      return (
        db.prepare('DELETE FROM ai_prompt_overrides WHERE template_id = ?').run(templateId)
          .changes > 0
      );
    },
  };
}

export type AiRuntimeRepo = ReturnType<typeof aiRuntimeRepo>;
