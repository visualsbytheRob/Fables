/**
 * Timeline view (F651, F653, F654, F656, F658): a vertical, day-grouped activity
 * feed over `GET /timeline`. Type-filter chips drive the server `types` param;
 * a zoom control re-buckets the already-fetched rows client-side (day / week /
 * month / year); rows link through to their underlying object; "Load more"
 * follows the cursor; and "Export chronicle" wires the F659 export endpoint.
 */
import { useMemo, useState, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Button, Download, FileText, History, Play, useToast } from '@fables/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  timelineApi,
  type TimelineGroup,
  type TimelineRow,
  type TimelineType,
} from './api.js';
import {
  filterByTypes,
  formatClock,
  formatDayHeading,
  rebucket,
  rowHref,
  type Zoom,
} from './grouping.js';
import './timeline.css';

const ALL_TYPES: TimelineType[] = ['notes', 'stories', 'playthroughs'];
const ZOOMS: Zoom[] = ['day', 'week', 'month', 'year'];
const PAGE_LIMIT = 50;

type IconComponent = ComponentType<{ size?: number }>;

const TYPE_ICON: Record<TimelineType, IconComponent> = {
  notes: FileText,
  stories: BookOpen,
  playthroughs: Play,
};

const TYPE_LABEL: Record<TimelineType, string> = {
  notes: 'Notes',
  stories: 'Stories',
  playthroughs: 'Playthroughs',
};

export function TimelinePage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [active, setActive] = useState<TimelineType[]>([...ALL_TYPES]);
  const [zoom, setZoom] = useState<Zoom>('day');
  // Accumulated server pages — each "Load more" appends another page of groups.
  const [pages, setPages] = useState<TimelineGroup[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  // The active types, sorted to a stable key so the query refetches on change
  // but not on reorder.
  const typesKey = useMemo(() => [...active].sort().join(','), [active]);

  const initial = useQuery({
    queryKey: ['timeline', typesKey],
    queryFn: async () => {
      const page = await timelineApi.list({ types: active, limit: PAGE_LIMIT });
      setPages(page.groups);
      setCursor(page.nextCursor);
      return page;
    },
  });

  const loadMore = useMutation({
    mutationFn: () =>
      timelineApi.list({
        types: active,
        limit: PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      }),
    onSuccess: (page) => {
      setPages((prev) => [...prev, ...page.groups]);
      setCursor(page.nextCursor);
    },
  });

  const exportChronicle = useMutation({
    mutationFn: () => timelineApi.export({ types: active }),
    onSuccess: (result) => {
      toast(`Chronicle "${result.note.title}" created`);
      navigate(`/notes/${result.note.id}`);
    },
    onError: () => toast('Could not export chronicle', 'error'),
  });

  // Filter (client mirror of the server param) then re-bucket by the zoom level.
  const view = useMemo(() => rebucket(filterByTypes(pages, active), zoom), [pages, active, zoom]);

  const toggleType = (type: TimelineType) =>
    setActive((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );

  const totalRows = view.reduce((n, g) => n + g.events.length, 0);

  return (
    <div className="timeline-page">
      <header className="timeline-page__bar" role="toolbar" aria-label="Timeline controls">
        <span className="timeline-page__chips">
          {ALL_TYPES.map((type) => {
            const Icon = TYPE_ICON[type];
            const on = active.includes(type);
            return (
              <button
                key={type}
                type="button"
                className={`timeline-chip${on ? ' timeline-chip--on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleType(type)}
              >
                <Icon size={13} />
                {TYPE_LABEL[type]}
              </button>
            );
          })}
        </span>

        <span className="timeline-page__zoom" role="group" aria-label="Zoom level">
          {ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              className={`timeline-zoom${z === zoom ? ' timeline-zoom--on' : ''}`}
              aria-pressed={z === zoom}
              onClick={() => setZoom(z)}
            >
              {z}
            </button>
          ))}
        </span>

        <Button
          className="timeline-page__export"
          onClick={() => exportChronicle.mutate()}
          disabled={exportChronicle.isPending}
        >
          <Download size={14} />
          {exportChronicle.isPending ? 'Exporting…' : 'Export chronicle'}
        </Button>
      </header>

      {initial.isPending && <p className="timeline-page__hint">Loading timeline…</p>}
      {initial.isError && <p className="timeline-page__hint">Could not load the timeline.</p>}
      {initial.isSuccess && totalRows === 0 && (
        <p className="timeline-page__hint">No activity matches these filters yet.</p>
      )}

      <ol className="timeline-feed">
        {view.map((group) => (
          <li key={group.dayKey} className="timeline-day">
            <h2 className="timeline-day__heading">{formatDayHeading(group.dayKey)}</h2>
            <ol className="timeline-day__events">
              {group.events.map((row) => (
                <TimelineRowItem key={row.id} row={row} />
              ))}
            </ol>
          </li>
        ))}
      </ol>

      {cursor !== null && (
        <div className="timeline-page__more">
          <Button onClick={() => loadMore.mutate()} disabled={loadMore.isPending}>
            {loadMore.isPending ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

function TimelineRowItem({ row }: { row: TimelineRow }) {
  const Icon = TYPE_ICON[row.type] ?? History;
  const clock = formatClock(row.at);
  return (
    <li className="timeline-row">
      <Link className="timeline-row__link" to={rowHref(row)}>
        <span className={`timeline-row__icon timeline-row__icon--${row.type}`}>
          <Icon size={15} />
        </span>
        <span className="timeline-row__body">
          <span className="timeline-row__title">{row.title || 'Untitled'}</span>
          <span className="timeline-row__event">{row.event}</span>
        </span>
        {clock && <time className="timeline-row__time">{clock}</time>}
      </Link>
    </li>
  );
}

export default TimelinePage;
