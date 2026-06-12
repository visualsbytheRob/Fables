/**
 * Journal API flows (F251/F252/F257): find-or-create the Journal notebook,
 * find-or-create the daily note for a day key, and append timestamped
 * quick-capture entries to today's note.
 */
import { notebooksApi, notesApi, type Note, type Notebook } from '../api/client.js';
import { fetchAllNotes } from '../api/hooks.js';
import { loadDailySections } from '../notes/prefs.js';
import { formatTime } from '../templates/variables.js';
import { dailyBody, dayKey } from './dayKeys.js';

export const JOURNAL_NOTEBOOK_NAME = 'Journal';

/** Find the Journal notebook by name (case-insensitive) or create it (F251). */
export async function findOrCreateJournal(): Promise<Notebook> {
  const notebooks = await notebooksApi.list();
  const existing = notebooks.find(
    (nb) => nb.name.trim().toLowerCase() === JOURNAL_NOTEBOOK_NAME.toLowerCase(),
  );
  if (existing) return existing;
  return notebooksApi.create({ name: JOURNAL_NOTEBOOK_NAME });
}

/** The daily note titled `key` in `notebookId`, or null. */
export async function findDailyNote(notebookId: string, key: string): Promise<Note | null> {
  const notes = await fetchAllNotes(notebookId);
  return notes.find((n) => n.title.trim() === key) ?? null;
}

/**
 * Find-or-create the daily note for `key` (F252): creates the Journal
 * notebook when missing and seeds the configurable section template (F254).
 */
export async function ensureDailyNote(
  key: string = dayKey(),
  sections: string[] = loadDailySections(),
): Promise<Note> {
  const journal = await findOrCreateJournal();
  const existing = await findDailyNote(journal.id, key);
  if (existing) return existing;
  return notesApi.create({ notebookId: journal.id, title: key, body: dailyBody(key, sections) });
}

/** Appends a timestamped capture line to today's daily note (F257). */
export async function appendToToday(text: string, now: Date = new Date()): Promise<Note> {
  const note = await ensureDailyNote(dayKey(now));
  const entry = `- **${formatTime(now)}** ${text.trim()}`;
  const body = note.body.trimEnd() === '' ? entry : `${note.body.trimEnd()}\n${entry}`;
  return notesApi.patch(note.id, { rev: note.rev, body: `${body}\n` });
}
