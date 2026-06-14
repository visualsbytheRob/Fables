/**
 * Host-side capability handler (F1021–F1040).
 *
 * Implements the actual data access for every capability a plugin can call.
 * All calls are rate-limited (tracked in-memory per plugin, reset each minute).
 * This runs in the HOST process — never in the worker.
 */

import type { CapabilityCall } from '@fables/plugin-sdk';
import type { Db } from '../db/connection.js';
import { notesRepo } from '../db/repos/notes.js';
import { tagsRepo } from '../db/repos/tags.js';
import { pluginsRepo } from '../db/repos/plugins.js';
import { parseFql } from '../fql/parse.js';
import { compileFql } from '../fql/compile.js';
import { safeFetch } from '../lib/ssrf.js';
import type { NoteId, NotebookId } from '@fables/core';

/** Run a FQL query against the notes table, return matching Note rows. */
function runFqlQuery(db: Db, fql: string, limit: number, cursor: string | null | undefined) {
  const parsed = parseFql(fql);
  const compiled = compileFql(parsed.ast);
  const cursorClause = cursor ? `AND n.id > ?` : '';
  const sql = `SELECT n.* FROM notes n WHERE (${compiled.where}) AND n.trashed_at IS NULL ${cursorClause} ORDER BY n.updated_at DESC LIMIT ?`;
  const params: unknown[] = [...compiled.params, ...(cursor ? [cursor] : []), limit + 1];
  return db.prepare(sql).all(...params) as Array<{
    id: string;
    notebook_id: string;
    title: string;
    body: string;
    pinned: number;
    trashed_at: string | null;
    created_at: string;
    updated_at: string;
    rev: number;
  }>;
}

/** Per-plugin per-minute rate counters. */
const rateCounts = new Map<string, { reads: number; writes: number; reset: number }>();

const MAX_READS_PER_MINUTE = 6_000;
const MAX_WRITES_PER_MINUTE = 600;

function getRateCounter(pluginId: string) {
  const now = Date.now();
  let c = rateCounts.get(pluginId);
  if (!c || now - c.reset > 60_000) {
    c = { reads: 0, writes: 0, reset: now };
    rateCounts.set(pluginId, c);
  }
  return c;
}

function checkReadRate(pluginId: string): void {
  const c = getRateCounter(pluginId);
  c.reads++;
  if (c.reads > MAX_READS_PER_MINUTE) {
    throw new Error(`rate limit exceeded: ${MAX_READS_PER_MINUTE} read calls per minute`);
  }
}

function checkWriteRate(pluginId: string): void {
  const c = getRateCounter(pluginId);
  c.writes++;
  if (c.writes > MAX_WRITES_PER_MINUTE) {
    throw new Error(`rate limit exceeded: ${MAX_WRITES_PER_MINUTE} write calls per minute`);
  }
}

/**
 * Registered VM functions and effects from plugins.
 * These are stored globally so the ForgeVM host integration can call them.
 */
export const vmFunctionRegistry = new Map<
  string,
  { pluginId: string; deterministic: boolean; parameters: string[] }
>();
export const vmEffectRegistry = new Map<string, { pluginId: string }>();

/** Pending VM function calls: id → { resolve, reject } */
export const vmPendingCalls = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

export function buildCapabilityHandler(db: Db, pluginId: string) {
  return async function handleCapability(call: CapabilityCall): Promise<unknown> {
    const notes = notesRepo(db);
    const tags = tagsRepo(db);
    const storage = pluginsRepo(db);

    switch (call.cap) {
      case 'notes.query': {
        checkReadRate(pluginId);
        const { fql, limit = 50, cursor } = call.params;
        if (fql) {
          const rows = runFqlQuery(db, fql, limit, cursor);
          const hasMore = rows.length > limit;
          const data = hasMore ? rows.slice(0, limit) : rows;
          return {
            notes: data.map((r) => ({
              id: r.id,
              notebookId: r.notebook_id,
              title: r.title,
              body: r.body,
              createdAt: r.created_at,
              updatedAt: r.updated_at,
              rev: r.rev,
              tags: [],
            })),
            nextCursor: hasMore && data[data.length - 1] ? data[data.length - 1]!.id : null,
          };
        } else {
          const page = notes.list({ sort: 'updated', fetch: limit + 1, cursor: cursor ?? null });
          const hasMore = page.length > limit;
          const data = hasMore ? page.slice(0, limit) : page;
          return {
            notes: data.map((n) => ({ ...n, tags: [] })),
            nextCursor: hasMore && data[data.length - 1] ? data[data.length - 1]!.id : null,
          };
        }
      }

      case 'notes.get': {
        checkReadRate(pluginId);
        const note = notes.get(call.params.id as NoteId);
        if (!note) return null;
        const noteTags = tags.tagsForNote(note.id);
        return { ...note, tags: noteTags.map((t) => t.name) };
      }

      case 'notes.create': {
        checkWriteRate(pluginId);
        const { notebookId, title, body } = call.params;
        const note = notes.create({
          notebookId: notebookId as NotebookId,
          title,
          body: `${body ?? ''}\n\n<!-- created by plugin:${pluginId} -->`.trim(),
        });
        return { ...note, tags: [] };
      }

      case 'notes.update': {
        checkWriteRate(pluginId);
        const { id, rev, title, body } = call.params;
        const patch: { title?: string; body?: string } = {};
        if (title !== undefined) patch.title = title;
        if (body !== undefined) patch.body = body;
        const updated = notes.update(id as NoteId, rev, patch);
        return { ...updated, tags: [] };
      }

      case 'notes.tags': {
        checkReadRate(pluginId);
        const noteTags = tags.tagsForNote(call.params.noteId as NoteId);
        return noteTags.map((t) => t.name);
      }

      case 'tags.list': {
        checkReadRate(pluginId);
        const allTags = tags.listWithCounts();
        return allTags.map((t) => t.name);
      }

      case 'storage.get': {
        return storage.storageGet(pluginId, call.params.key);
      }

      case 'storage.set': {
        storage.storageSet(pluginId, call.params.key, call.params.value);
        return null;
      }

      case 'storage.delete': {
        storage.storageDelete(pluginId, call.params.key);
        return null;
      }

      case 'vm.registerFunction': {
        vmFunctionRegistry.set(call.params.name, {
          pluginId,
          deterministic: call.params.deterministic,
          parameters: call.params.parameters,
        });
        return null;
      }

      case 'vm.registerEffect': {
        vmEffectRegistry.set(call.params.name, { pluginId });
        return null;
      }

      case 'vm.readState': {
        // VM state access: return a stub (real integration hooks into the VM saves repo)
        const { storyId, key } = call.params;
        const row = db
          .prepare(
            'SELECT variables FROM story_saves WHERE story_id = ? ORDER BY saved_at DESC LIMIT 1',
          )
          .get(storyId) as { variables: string } | undefined;
        if (!row) return null;
        const vars = JSON.parse(row.variables) as Record<string, unknown>;
        return vars[key] ?? null;
      }

      case 'http.fetch': {
        // Network capability (F1083). Routed through the SSRF guard so a plugin
        // with the `network` permission still cannot reach private/internal or
        // cloud-metadata addresses (F1268/F1273 — plugin escalation closed).
        const { url, method = 'GET', headers = {}, body: reqBody } = call.params;
        const fetchInit: RequestInit = {
          method,
          headers,
          signal: AbortSignal.timeout(10_000),
        };
        if (reqBody !== undefined) fetchInit.body = reqBody;
        const resp = await safeFetch(url, fetchInit);
        const respBody = await resp.text();
        const respHeaders: Record<string, string> = {};
        resp.headers.forEach((v, k) => {
          respHeaders[k] = v;
        });
        return { status: resp.status, body: respBody, headers: respHeaders };
      }

      case 'search.extend': {
        // Invoked from search route to gather plugin results
        return { query: call.params.query, results: [] };
      }

      // event.subscribe / event.unsubscribe handled in sandbox.ts before reaching here
      default: {
        throw new Error(`unknown capability "${(call as { cap: string }).cap}"`);
      }
    }
  };
}
