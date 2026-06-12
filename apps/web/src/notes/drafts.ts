/**
 * Local draft recovery (F186): while editing, the current title/body is
 * mirrored to localStorage keyed by note id. After a successful save the
 * draft is cleared; if the tab dies mid-edit, the next open of that note
 * finds a draft newer than the server copy and offers to recover it.
 */

export interface Draft {
  noteId: string;
  title: string;
  body: string;
  /** The server rev the draft was based on. */
  baseRev: number;
  savedAt: number;
}

const keyFor = (noteId: string): string => `fables.notes.draft.${noteId}`;

export function saveDraft(draft: Draft): void {
  try {
    localStorage.setItem(keyFor(draft.noteId), JSON.stringify(draft));
  } catch {
    // storage full/unavailable — recovery just won't be possible
  }
}

export function loadDraft(noteId: string): Draft | null {
  try {
    const raw = localStorage.getItem(keyFor(noteId));
    if (raw === null) return null;
    const draft = JSON.parse(raw) as Draft;
    return typeof draft.body === 'string' && typeof draft.baseRev === 'number' ? draft : null;
  } catch {
    return null;
  }
}

export function clearDraft(noteId: string): void {
  try {
    localStorage.removeItem(keyFor(noteId));
  } catch {
    // ignore
  }
}

/**
 * A draft is worth offering when it differs from the loaded note content.
 * (Same-content drafts are stale mirror writes and are silently dropped.)
 */
export function recoverableDraft(
  noteId: string,
  current: { title: string; body: string },
): Draft | null {
  const draft = loadDraft(noteId);
  if (!draft) return null;
  if (draft.title === current.title && draft.body === current.body) {
    clearDraft(noteId);
    return null;
  }
  return draft;
}
