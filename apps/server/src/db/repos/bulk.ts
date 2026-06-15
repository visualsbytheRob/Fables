/**
 * Bulk-operations repository (Epic 20, F1951–F1958).
 *
 * The persistence + journal layer over the pure `bulk/engine`: it scopes the
 * notes an operation runs against, previews a plan (no writes), applies a plan
 * inside one transaction (note updates, created notes, deletions, tag
 * reconciliation), and journals a full before-snapshot so any batch is
 * reversible (F1958). Undo replays the snapshot: deletions are recreated,
 * additions removed, and changed notes restored.
 */

import { nowIso, type NoteId, type NotebookId, type TagId } from '@fables/core';
import type { Db } from '../connection.js';
import { notesRepo } from './notes.js';
import { tagsRepo } from './tags.js';
import { runFqlQuery } from '../../services/query.js';
import { planBulk, type BulkNote, type BulkOp, type BulkPlan } from '../../bulk/engine.js';

export interface BulkScope {
  notebookId?: string | undefined;
  query?: string | undefined;
  noteIds?: string[] | undefined;
}

export interface JournalEntry {
  id: string;
  op: BulkOp;
  summary: string;
  affected: number;
  reversed: boolean;
  createdAt: string;
}

interface JournalRow {
  id: string;
  op: string;
  summary: string;
  before: string;
  added_ids: string;
  affected: number;
  reversed: number;
  created_at: string;
}

const toEntry = (r: JournalRow): JournalEntry => ({
  id: r.id,
  op: JSON.parse(r.op) as BulkOp,
  summary: r.summary,
  affected: r.affected,
  reversed: r.reversed === 1,
  createdAt: r.created_at,
});

export interface ApplyResult {
  journalId: string;
  plan: BulkPlan;
  createdIds: string[];
  removedIds: string[];
}

export function bulkRepo(db: Db) {
  const notes = notesRepo(db);
  const tags = tagsRepo(db);

  const toBulkNote = (id: string): BulkNote | null => {
    const note = notes.get(id as NoteId);
    if (!note) return null;
    return {
      id: note.id,
      title: note.title,
      body: note.body,
      tags: tags.tagsForNote(note.id).map((t) => t.name),
      notebookId: note.notebookId,
    };
  };

  /** Reconcile a note's tags to exactly `target` (add missing, drop extra). */
  const setTags = (noteId: string, target: string[]): void => {
    const current = new Set(tags.tagsForNote(noteId as NoteId).map((t) => t.name));
    const want = new Set(target);
    for (const name of want) {
      if (!current.has(name)) tags.linkNote(noteId as NoteId, tags.ensure(name).id, false);
    }
    for (const name of current) {
      if (!want.has(name)) {
        const t = tags.getByName(name);
        if (t) {
          db.prepare('DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?').run(
            noteId,
            t.id as TagId,
          );
        }
      }
    }
  };

  /** Write a BulkNote's title/body/notebook + tags onto an existing note. */
  const writeNote = (target: BulkNote): void => {
    const note = notes.get(target.id as NoteId);
    if (!note) return;
    if (
      note.title !== target.title ||
      note.body !== target.body ||
      note.notebookId !== target.notebookId
    ) {
      notes.update(note.id, note.rev, {
        title: target.title,
        body: target.body,
        notebookId: target.notebookId as NotebookId,
      });
    }
    setTags(target.id, target.tags);
  };

  /** Create a fresh note from a BulkNote snapshot; returns its new id. */
  const createNote = (snapshot: BulkNote): string => {
    const created = notes.create({
      notebookId: snapshot.notebookId as NotebookId,
      title: snapshot.title,
      body: snapshot.body,
    });
    setTags(created.id, snapshot.tags);
    return created.id;
  };

  const repo = {
    /** Load the BulkNotes an operation will run against. */
    scopedNotes(scope: BulkScope): BulkNote[] {
      let ids: string[];
      if (scope.noteIds !== undefined) {
        ids = scope.noteIds;
      } else if (scope.query !== undefined) {
        ids = runFqlQuery(db, scope.query, { fetch: 5000, cursor: null }).notes.map((n) => n.id);
      } else if (scope.notebookId !== undefined) {
        ids = notes.listByNotebook(scope.notebookId as NotebookId).map((n) => n.id);
      } else {
        ids = notes.listTitles().map((n) => n.id);
      }
      return ids.map(toBulkNote).filter((n): n is BulkNote => n !== null);
    },

    /** Preview a plan without writing anything (F1951 preview half). */
    preview(op: BulkOp, scope: BulkScope): BulkPlan {
      return planBulk(this.scopedNotes(scope), op);
    },

    /** Apply a plan in one transaction and journal it for undo (F1951/F1958). */
    apply(op: BulkOp, scope: BulkScope): ApplyResult {
      const scoped = this.scopedNotes(scope);
      const plan = planBulk(scoped, op);

      // Full before-snapshot: every diffed note + every note about to be removed.
      const byId = new Map(scoped.map((n) => [n.id, n]));
      const before: BulkNote[] = [];
      for (const d of plan.diffs) before.push(d.before);
      for (const id of plan.removed) {
        const snap = byId.get(id);
        if (snap) before.push(snap);
      }

      const createdIds: string[] = [];
      const tx = db.transaction(() => {
        for (const diff of plan.diffs) writeNote(diff.after);
        for (const added of plan.added) createdIds.push(createNote(added));
        for (const id of plan.removed) notes.trash(id as NoteId);
      });
      tx();

      const journalId = `bulk_${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO bulk_journal (id, op, summary, before, added_ids, affected, reversed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(
        journalId,
        JSON.stringify(op),
        plan.summary,
        JSON.stringify(before),
        JSON.stringify(createdIds),
        plan.totalAffected,
        nowIso(),
      );

      return { journalId, plan, createdIds, removedIds: plan.removed };
    },

    /** Reverse a journalled operation (F1958): restore snapshots, undo add/remove. */
    undo(journalId: string): { restored: number } | null {
      const row = db.prepare('SELECT * FROM bulk_journal WHERE id = ?').get(journalId) as
        | JournalRow
        | undefined;
      if (!row || row.reversed === 1) return null;
      const before = JSON.parse(row.before) as BulkNote[];
      const addedIds = JSON.parse(row.added_ids) as string[];

      const tx = db.transaction(() => {
        // Remove anything the op created.
        for (const id of addedIds) {
          if (notes.get(id as NoteId)) notes.trash(id as NoteId);
        }
        // Restore every snapshot: update if it still exists, recreate otherwise.
        for (const snap of before) {
          if (notes.get(snap.id as NoteId)) writeNote(snap);
          else createNote(snap);
        }
      });
      tx();

      db.prepare('UPDATE bulk_journal SET reversed = 1 WHERE id = ?').run(journalId);
      return { restored: before.length };
    },

    get(id: string): JournalEntry | null {
      const row = db.prepare('SELECT * FROM bulk_journal WHERE id = ?').get(id) as
        | JournalRow
        | undefined;
      return row ? toEntry(row) : null;
    },

    history(limit = 100): JournalEntry[] {
      return (
        db
          .prepare('SELECT * FROM bulk_journal ORDER BY created_at DESC LIMIT ?')
          .all(limit) as JournalRow[]
      ).map(toEntry);
    },
  };

  return repo;
}

export type BulkRepo = ReturnType<typeof bulkRepo>;
