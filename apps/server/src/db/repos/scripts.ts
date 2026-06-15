/**
 * Script library repository (Epic 20, F1942–F1947).
 *
 * Persists saved console scripts (migration 045) and validates their declared
 * capability scopes against the known surface. A script may carry a cron for
 * scheduled execution (F1943); the static scope check (F1947) runs on save so a
 * script can't silently declare an unknown scope.
 */

import { nowIso, validation } from '@fables/core';
import type { Db } from '../connection.js';
import { checkScopes, isKnownScope, type ScopeCheck } from '../../scripting/analyze.js';
import { isValidCron } from '../../jobs/cron.js';

export interface Script {
  id: string;
  name: string;
  description: string;
  source: string;
  scopes: string[];
  cron: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ScriptRow {
  id: string;
  name: string;
  description: string;
  source: string;
  scopes: string;
  cron: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

const toScript = (r: ScriptRow): Script => ({
  id: r.id,
  name: r.name,
  description: r.description,
  source: r.source,
  scopes: JSON.parse(r.scopes) as string[],
  cron: r.cron,
  enabled: r.enabled === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface ScriptInput {
  name: string;
  source: string;
  description?: string;
  scopes?: string[];
  cron?: string | null;
  enabled?: boolean;
}

function assertScopes(scopes: string[]): void {
  for (const s of scopes) {
    if (!isKnownScope(s)) throw validation(`unknown scope: ${s}`);
  }
}

export function scriptsRepo(db: Db) {
  const repo = {
    create(input: ScriptInput): Script {
      assertScopes(input.scopes ?? []);
      if (input.cron != null && !isValidCron(input.cron)) {
        throw validation(`invalid cron expression: ${input.cron}`);
      }
      const now = nowIso();
      const script: Script = {
        id: `scr_${crypto.randomUUID()}`,
        name: input.name,
        description: input.description ?? '',
        source: input.source,
        scopes: input.scopes ?? [],
        cron: input.cron ?? null,
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO scripts (id, name, description, source, scopes, cron, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        script.id,
        script.name,
        script.description,
        script.source,
        JSON.stringify(script.scopes),
        script.cron,
        script.enabled ? 1 : 0,
        now,
        now,
      );
      return script;
    },

    get(id: string): Script | null {
      const row = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id) as ScriptRow | undefined;
      return row ? toScript(row) : null;
    },

    list(): Script[] {
      return (db.prepare('SELECT * FROM scripts ORDER BY name').all() as ScriptRow[]).map(toScript);
    },

    update(
      id: string,
      patch: {
        name?: string | undefined;
        description?: string | undefined;
        source?: string | undefined;
        scopes?: string[] | undefined;
        cron?: string | null | undefined;
        enabled?: boolean | undefined;
      },
    ): Script | null {
      const cur = this.get(id);
      if (!cur) return null;
      if (patch.scopes !== undefined) assertScopes(patch.scopes);
      if (patch.cron != null && !isValidCron(patch.cron)) {
        throw validation(`invalid cron expression: ${patch.cron}`);
      }
      const next: Script = {
        ...cur,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.scopes !== undefined ? { scopes: patch.scopes } : {}),
        ...(patch.cron !== undefined ? { cron: patch.cron } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        updatedAt: nowIso(),
      };
      db.prepare(
        `UPDATE scripts SET name = ?, description = ?, source = ?, scopes = ?, cron = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      ).run(
        next.name,
        next.description,
        next.source,
        JSON.stringify(next.scopes),
        next.cron,
        next.enabled ? 1 : 0,
        next.updatedAt,
        id,
      );
      return next;
    },

    remove(id: string): boolean {
      return db.prepare('DELETE FROM scripts WHERE id = ?').run(id).changes > 0;
    },

    /** Static scope check for a stored script (F1946/F1947). */
    check(id: string): ScopeCheck | null {
      const script = this.get(id);
      if (!script) return null;
      return checkScopes(script.source, script.scopes);
    },
  };

  return repo;
}

export type ScriptsRepo = ReturnType<typeof scriptsRepo>;
