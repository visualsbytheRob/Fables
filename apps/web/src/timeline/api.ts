/**
 * Timeline API client (F651–F659). Wraps the server's unified activity feed
 * (`GET /timeline`), per-entity timelines, per-story chronology, and the
 * chronicle export endpoint. All requests go through the shared `api` client,
 * which unwraps the `{ data }` envelope for us.
 */
import { api } from '../api/client.js';

export type TimelineType = 'notes' | 'stories' | 'playthroughs';

export interface TimelineRow {
  id: string;
  type: TimelineType;
  event: string;
  at: string;
  title: string;
  refId: string;
  meta: Record<string, unknown>;
}

export interface TimelineGroup {
  dayKey: string;
  events: TimelineRow[];
}

export interface TimelinePage {
  groups: TimelineGroup[];
  nextCursor: string | null;
}

export interface ChronologyEntry {
  when: string;
  file: string;
  scene: string | null;
}

export interface EntityTimelineEvent {
  type: 'mention' | 'mutation' | 'encounter';
  at: string;
  title: string;
  meta: Record<string, unknown>;
}

export interface TimelineListParams {
  types?: TimelineType[];
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface TimelineExportBody {
  types?: TimelineType[];
  from?: string;
  to?: string;
}

/** Minimal note shape returned by the export endpoint (we only need id/title). */
export interface ExportedChronicle {
  note: { id: string; title: string };
}

/** Builds the query string for the list endpoint; omits empty params. */
function listQuery(params: TimelineListParams): string {
  const search = new URLSearchParams();
  if (params.types && params.types.length > 0) search.set('types', params.types.join(','));
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const timelineApi = {
  list: (params: TimelineListParams = {}) =>
    api.get<TimelinePage>(`/timeline${listQuery(params)}`),
  entityTimeline: (id: string) =>
    api.get<EntityTimelineEvent[]>(`/entities/${id}/timeline`),
  chronology: (storyId: string) =>
    api.get<ChronologyEntry[]>(`/stories/${storyId}/chronology`),
  export: (body: TimelineExportBody = {}) =>
    api.post<ExportedChronicle>('/timeline/export', body),
};
