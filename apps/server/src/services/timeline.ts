import { dayKey, type EntityId, type StoryId } from '@fables/core';
import { parse } from '@fables/forge-dsl';
import type { Db } from '../db/connection.js';
import { codexRepo } from '../db/repos/codex.js';
import { entitiesRepo } from '../db/repos/entities.js';
import { linksRepo } from '../db/repos/links.js';
import { storiesRepo } from '../db/repos/stories.js';
import { timelineRepo, type TimelineRow, type TimelineType } from '../db/repos/timeline.js';

export type { TimelineType } from '../db/repos/timeline.js';

/**
 * Timeline aggregation (F651–F660): merge note/story/playthrough events into a
 * single feed grouped by calendar day, cursor-paginated; per-story chronology
 * from `# when:` tags; per-entity timelines; markdown chronicle export.
 */

export const TIMELINE_TYPES: TimelineType[] = ['notes', 'stories', 'playthroughs'];

export interface TimelineGroup {
  dayKey: string;
  events: TimelineRow[];
}

export interface TimelineFilter {
  types?: TimelineType[];
  from?: string;
  to?: string;
  limit: number;
  cursor: string | null;
}

export interface TimelinePage {
  groups: TimelineGroup[];
  nextCursor: string | null;
}

/** Newest-first ordering with a stable id tiebreak so the cursor is unambiguous. */
function byNewest(a: TimelineRow, b: TimelineRow): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

function allEvents(db: Db, types: TimelineType[]): TimelineRow[] {
  const repo = timelineRepo(db);
  const out: TimelineRow[] = [];
  if (types.includes('notes')) out.push(...repo.noteEvents());
  if (types.includes('stories')) out.push(...repo.storyEvents());
  if (types.includes('playthroughs')) out.push(...repo.playthroughEvents());
  return out.sort(byNewest);
}

export function buildTimeline(db: Db, filter: TimelineFilter): TimelinePage {
  const types = filter.types ?? TIMELINE_TYPES;
  let events = allEvents(db, types);
  if (filter.from !== undefined) events = events.filter((e) => e.at >= filter.from!);
  if (filter.to !== undefined) events = events.filter((e) => e.at <= filter.to!);

  // Cursor is the id of the last event already returned; resume strictly after it.
  if (filter.cursor !== null) {
    const idx = events.findIndex((e) => e.id === filter.cursor);
    events = idx === -1 ? events : events.slice(idx + 1);
  }

  const slice = events.slice(0, filter.limit);
  const nextCursor =
    events.length > filter.limit ? (slice[slice.length - 1]?.id ?? null) : null;

  const groups: TimelineGroup[] = [];
  let current: TimelineGroup | null = null;
  for (const event of slice) {
    const key = dayKey(new Date(event.at));
    if (!current || current.dayKey !== key) {
      current = { dayKey: key, events: [] };
      groups.push(current);
    }
    current.events.push(event);
  }
  return { groups, nextCursor };
}

// ── chronology (F655/F656) ────────────────────────────────────────────────

export interface ChronologyEntry {
  /** The `when` value as written, e.g. `year 312`. */
  when: string;
  /** Source file the chronology marker came from. */
  file: string;
  /** Knot/scene name nearest the marker, when discoverable. */
  scene: string | null;
}

/**
 * Story-world chronology from `# when:` header tags across the story's files
 * (F655). Entries keep author order; the player renders them as a story-world
 * timeline (F656).
 */
export function storyChronology(db: Db, storyId: StoryId): ChronologyEntry[] {
  const story = storiesRepo(db).mustGet(storyId);
  const entries: ChronologyEntry[] = [];
  for (const file of storiesRepo(db).listFiles(storyId)) {
    let parsed;
    try {
      parsed = parse(file.source, { fileName: file.path });
    } catch {
      continue;
    }
    const firstKnot = parsed.story.knots[0]?.name.name ?? null;
    for (const tag of parsed.story.headerTags) {
      const colon = tag.text.indexOf(':');
      if (colon === -1) continue;
      const key = tag.text.slice(0, colon).trim().toLowerCase();
      if (key !== 'when') continue;
      entries.push({
        when: tag.text.slice(colon + 1).trim(),
        file: file.path,
        scene: file.path === story.entryFile ? null : firstKnot,
      });
    }
  }
  return entries;
}

// ── entity timeline (F657) ─────────────────────────────────────────────────

export interface EntityTimelineEvent {
  type: 'mention' | 'mutation' | 'encounter';
  at: string;
  title: string;
  meta: Record<string, unknown>;
}

/** Every event involving one entity: mentions, mutations, encounters (F657). */
export function entityTimeline(db: Db, entityId: EntityId): EntityTimelineEvent[] {
  const entity = entitiesRepo(db).mustGet(entityId);
  const events: EntityTimelineEvent[] = [];

  for (const m of linksRepo(db).incoming(entity.id, 'mention')) {
    events.push({
      type: 'mention',
      at: m.sourceUpdatedAt,
      title: m.sourceTitle,
      meta: { noteId: m.sourceId, position: m.position },
    });
  }
  for (const mut of codexRepo(db).listMutationsForEntity(entity.id)) {
    events.push({
      type: 'mutation',
      at: mut.at,
      title: `${mut.field} → ${JSON.stringify(mut.newValue)}`,
      meta: {
        storyId: mut.storyId,
        playthroughId: mut.playthroughId,
        field: mut.field,
        kind: mut.kind,
        sandbox: mut.sandbox,
      },
    });
  }
  const enc = db
    .prepare(
      `SELECT story_id, playthrough_id, first_at, count FROM playthrough_encounters
       WHERE entity_id = ? ORDER BY first_at`,
    )
    .all(entity.id) as {
    story_id: string;
    playthrough_id: string;
    first_at: string;
    count: number;
  }[];
  for (const e of enc) {
    events.push({
      type: 'encounter',
      at: e.first_at,
      title: `encountered in ${e.story_id}`,
      meta: { storyId: e.story_id, playthroughId: e.playthrough_id, count: e.count },
    });
  }

  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// ── markdown export (F659) ──────────────────────────────────────────────────

/** Render a timeline page (already filtered) as a markdown chronicle body (F659). */
export function renderChronicleMarkdown(title: string, groups: TimelineGroup[]): string {
  const lines: string[] = [`# ${title}`, ''];
  for (const group of groups) {
    lines.push(`## ${group.dayKey}`, '');
    for (const event of group.events) {
      const time = new Date(event.at).toISOString().slice(11, 16);
      lines.push(`- **${time}** \`${event.event}\` — ${event.title}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
