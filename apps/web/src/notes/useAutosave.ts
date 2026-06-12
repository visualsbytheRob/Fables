/**
 * Debounced autosave with optimistic-rev tracking (F181), 409 conflict
 * detection (F182), draft mirroring for crash recovery (F186), and a
 * force-save flush for Mod-S (F189).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isConflictError, notesApi, type Note, type NoteWithTags } from '../api/client.js';
import { clearDraft, saveDraft } from './drafts.js';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';

export interface AutosaveState {
  status: SaveStatus;
  /** The note as the server last returned it (rev source of truth). */
  serverNote: Note | null;
  /** Set while a 409 is unresolved: the freshest server copy to compare against. */
  conflict: NoteWithTags | null;
}

export interface AutosaveApi extends AutosaveState {
  /** Report a local edit; schedules a debounced save. */
  onEdit: (content: { title: string; body: string }) => void;
  /** Save immediately (Mod-S / before navigation). */
  flush: () => Promise<void>;
  /** Conflict resolution: accept the server copy (caller reloads content). */
  acceptTheirs: () => void;
  /** Conflict resolution: overwrite the server copy with local content. */
  keepMine: () => Promise<void>;
  /** True when there are unsaved local edits (F188 navigation guard). */
  isDirty: () => boolean;
}

export const AUTOSAVE_DELAY_MS = 900;

export function useAutosave(note: NoteWithTags | null): AutosaveApi {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [conflict, setConflict] = useState<NoteWithTags | null>(null);
  const serverNoteRef = useRef<Note | null>(null);
  const pendingRef = useRef<{ title: string; body: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  // New note selected: reset tracking to its server state.
  const noteId = note?.id ?? null;
  const lastIdRef = useRef<string | null>(null);
  if (noteId !== lastIdRef.current) {
    lastIdRef.current = noteId;
    serverNoteRef.current = note;
    pendingRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
  }
  // Server refetches bump the tracked rev when we have no local edits in play.
  if (note && serverNoteRef.current && note.id === serverNoteRef.current.id) {
    if (note.rev > serverNoteRef.current.rev && pendingRef.current === null) {
      serverNoteRef.current = note;
    }
  }

  const save = useCallback(async (): Promise<void> => {
    const base = serverNoteRef.current;
    const pending = pendingRef.current;
    if (!base || !pending || inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus('saving');
    try {
      const updated = await notesApi.patch(base.id, {
        rev: base.rev,
        title: pending.title,
        body: pending.body,
      });
      serverNoteRef.current = updated;
      // Only clear the pending edit if nothing changed while saving.
      if (pendingRef.current === pending) {
        pendingRef.current = null;
        clearDraft(base.id);
        setStatus('saved');
      } else {
        setStatus('dirty');
      }
    } catch (error) {
      if (isConflictError(error)) {
        try {
          setConflict(await notesApi.get(base.id));
        } catch {
          setConflict(null);
        }
        setStatus('conflict');
      } else {
        setStatus('error');
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const onEdit = useCallback(
    (content: { title: string; body: string }) => {
      const base = serverNoteRef.current;
      if (!base) return;
      if (content.title === base.title && content.body === base.body && !pendingRef.current) {
        return; // no-op edit (e.g. initial mount)
      }
      pendingRef.current = content;
      saveDraft({
        noteId: base.id,
        title: content.title,
        body: content.body,
        baseRev: base.rev,
        savedAt: Date.now(),
      });
      setStatus('dirty');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    },
    [save],
  );

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await save();
  }, [save]);

  const acceptTheirs = useCallback(() => {
    if (conflict) {
      serverNoteRef.current = conflict;
      clearDraft(conflict.id);
    }
    pendingRef.current = null;
    setConflict(null);
    setStatus('idle');
  }, [conflict]);

  const keepMine = useCallback(async () => {
    // Re-base the local content on the server's rev, then overwrite.
    if (conflict && serverNoteRef.current) {
      serverNoteRef.current = { ...serverNoteRef.current, rev: conflict.rev };
    }
    setConflict(null);
    await save();
  }, [conflict, save]);

  const isDirty = useCallback(() => pendingRef.current !== null || inFlightRef.current, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return {
    status,
    serverNote: serverNoteRef.current,
    conflict,
    onEdit,
    flush,
    acceptTheirs,
    keepMine,
    isDirty,
  };
}
