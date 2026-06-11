import type { AttachmentId, NotebookId, NoteId, TagId } from './ids.js';

export interface Note {
  id: NoteId;
  notebookId: NotebookId;
  title: string;
  body: string;
  pinned: boolean;
  /** ISO timestamp when moved to trash; null when live. */
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Optimistic-concurrency revision counter, bumped on every write. */
  rev: number;
}

export interface Notebook {
  id: NotebookId;
  parentId: NotebookId | null;
  name: string;
  icon: string | null;
  color: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: TagId;
  /** Normalized lowercase name; nesting uses `/` (e.g. `world/characters`). */
  name: string;
  color: string | null;
  createdAt: string;
}

export interface Attachment {
  id: AttachmentId;
  noteId: NoteId | null;
  filename: string;
  mime: string;
  /** Size in bytes. */
  size: number;
  /** Content hash (sha256 hex) — storage is content-addressed. */
  hash: string;
  createdAt: string;
}
