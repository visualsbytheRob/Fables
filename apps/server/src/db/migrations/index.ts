import { migration001Notes } from './001-notes.js';
import { migration002Stories } from './002-stories.js';
import { migration003NoteRevisions } from './003-note-revisions.js';
import { migration004Attachments } from './004-attachments.js';
import { migration005Links } from './005-links.js';
import { migration006SavedQueries } from './006-saved-queries.js';
import { migration007ImportJobs } from './007-import-jobs.js';
import { migration008StoryProjects } from './008-story-projects.js';

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
  migration005Links,
  migration006SavedQueries,
  migration007ImportJobs,
  migration008StoryProjects,
];
