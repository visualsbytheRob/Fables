import { migration001Notes } from './001-notes.js';
import { migration002Stories } from './002-stories.js';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** Ordered, append-only. Never edit a shipped migration — add a new one. */
export const migrations: Migration[] = [migration001Notes, migration002Stories];
