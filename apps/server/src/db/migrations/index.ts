import { migration001Notes } from './001-notes.js';
import { migration002Stories } from './002-stories.js';
import { migration003NoteRevisions } from './003-note-revisions.js';
import { migration004Attachments } from './004-attachments.js';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** Ordered, append-only. Never edit a shipped migration — add a new one. */
export const migrations: Migration[] = [
  migration001Notes,
  migration002Stories,
  migration003NoteRevisions,
  migration004Attachments,
];
