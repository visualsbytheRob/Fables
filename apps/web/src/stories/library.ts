/**
 * Library model (F571–F579): pure assembly of stories + local reading state
 * into sortable/filterable shelf entries, plus the typographic-cover hue.
 */
import {
  loadEndings,
  loadLibraryMeta,
  loadStats,
  type LibraryMeta,
  type ReadingStats,
} from '../player/prefs.js';
import type { StoryProject } from './api.js';

export type ProgressBadge = 'new' | 'in-progress' | 'finished';

export interface LibraryEntry {
  readonly story: StoryProject;
  readonly meta: LibraryMeta;
  readonly stats: ReadingStats;
  readonly endingsFound: number;
  readonly badge: ProgressBadge;
}

export function badgeFor(stats: ReadingStats, endingsFound: number): ProgressBadge {
  if (endingsFound > 0 || stats.runsFinished > 0) return 'finished';
  if (stats.lastPlayedAt !== null) return 'in-progress';
  return 'new';
}

/** Join server stories with the locally persisted reading state. */
export function libraryEntries(stories: readonly StoryProject[]): LibraryEntry[] {
  return stories.map((story) => {
    const stats = loadStats(story.id);
    const endingsFound = loadEndings(story.id).length;
    return {
      story,
      meta: loadLibraryMeta(story.id),
      stats,
      endingsFound,
      badge: badgeFor(stats, endingsFound),
    };
  });
}

export type LibraryFilter = 'all' | 'in-progress' | 'finished' | 'new';
export type LibrarySort = 'recent' | 'title' | 'played';

export interface LibraryView {
  readonly shelf: LibraryEntry[];
  readonly archived: LibraryEntry[];
}

/** Search across title, blurb (description), author and tags (F579). */
export function matchesQuery(entry: LibraryEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const haystack = [
    entry.story.title,
    entry.story.description,
    entry.meta.author,
    ...entry.meta.tags,
  ]
    .join('\n')
    .toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

export function libraryView(
  entries: readonly LibraryEntry[],
  options: { query: string; filter: LibraryFilter; sort: LibrarySort },
): LibraryView {
  const matched = entries.filter(
    (e) =>
      matchesQuery(e, options.query) &&
      (options.filter === 'all' || e.badge === options.filter),
  );
  const sorted = [...matched].sort((a, b) => {
    if (options.sort === 'title') return a.story.title.localeCompare(b.story.title);
    if (options.sort === 'played') {
      return (b.stats.lastPlayedAt ?? '').localeCompare(a.stats.lastPlayedAt ?? '');
    }
    return b.story.updatedAt.localeCompare(a.story.updatedAt);
  });
  return {
    shelf: sorted.filter((e) => !e.meta.archived),
    archived: sorted.filter((e) => e.meta.archived),
  };
}

/** Stable hue for typographic covers without a configured color (F572). */
export function coverHue(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 33 + title.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

/** The CSS background for a cover: configured color wins, else a title hue. */
export function coverBackground(story: StoryProject): string {
  const color = story.settings?.cover.color;
  if (color != null && color !== '') return color;
  return `hsl(${coverHue(story.title)} 45% 32%)`;
}
